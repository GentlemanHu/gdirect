use crate::{
    api::{Api, File},
    download::{self, Stats},
    store::Store,
};
use anyhow::{Result, ensure};
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Layout},
    style::{Color, Style, Stylize},
    text::Line,
    widgets::{Block, Gauge, List, ListItem, ListState, Paragraph, Wrap},
};
use std::{
    collections::{HashSet, VecDeque},
    io::IsTerminal,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant},
};

pub struct Options {
    pub folder: String,
    pub output: PathBuf,
    pub ip: Option<IpAddr>,
    pub sni: Option<String>,
    pub connections: u8,
    pub ca_cert: Option<PathBuf>,
}
enum Message {
    Folder(String, Result<Vec<File>, String>),
    Preview(String, Result<Vec<File>, String>),
    Finished(String, Result<(), String>),
    /// Progress of a folder download: folder name and files found so far.
    Listing(String, usize),
    /// Every file below a folder, with the directory to save it in.
    Listed(String, Result<Vec<(File, PathBuf)>, String>),
}
#[derive(Clone, Debug, PartialEq)]
enum State {
    Queued,
    Active,
    Done,
    Failed(String),
}
struct Job {
    file: File,
    output: PathBuf,
    size: Option<u64>,
    state: State,
}
struct Active {
    id: String,
    stats: Stats,
    rx: Receiver<Stats>,
    cancel: Arc<AtomicBool>,
    worker: thread::JoinHandle<()>,
}
struct View {
    path: Vec<(String, String)>,
    files: Vec<File>,
    selection: ListState,
    preview: Vec<File>,
    preview_id: Option<String>,
    status: String,
    loading: bool,
    connections: u8,
    /// Files marked with space, kept across folders until queued.
    marked: Vec<File>,
    /// Every download of this session, in queue order.
    jobs: Vec<Job>,
    active: Option<Active>,
    /// Folder downloads still being listed.
    listing: usize,
    quitting: bool,
}
impl View {
    fn new(path: (String, String), files: Vec<File>, connections: u8) -> Self {
        Self {
            path: vec![path],
            selection: ListState::default().with_selected((!files.is_empty()).then_some(0)),
            files,
            preview: vec![],
            preview_id: None,
            status: String::new(),
            loading: true,
            connections,
            marked: vec![],
            jobs: vec![],
            active: None,
            listing: 0,
            quitting: false,
        }
    }
    fn selected(&self) -> Option<&File> {
        self.selection.selected().and_then(|i| self.files.get(i))
    }
    fn job(&self, id: &str) -> Option<&Job> {
        self.jobs.iter().find(|j| j.file.id == id)
    }
    fn job_mut(&mut self, id: &str) -> Option<&mut Job> {
        self.jobs.iter_mut().find(|j| j.file.id == id)
    }
    fn move_by(&mut self, delta: isize) {
        if self.files.is_empty() {
            self.selection.select(None);
            return;
        }
        let next = (self.selection.selected().unwrap_or(0) as isize + delta)
            .clamp(0, self.files.len() as isize - 1) as usize;
        self.selection.select(Some(next));
        self.preview.clear();
        self.preview_id = None;
    }
    fn toggle_mark(&mut self) {
        let Some(file) = self.selected().cloned() else {
            return;
        };
        if !file.folder() && !file.downloadable() {
            self.status = format!("{} cannot be downloaded", file.name);
        } else if let Some(i) = self.marked.iter().position(|f| f.id == file.id) {
            self.marked.remove(i);
        } else {
            self.marked.push(file);
        }
        self.move_by(1);
    }
    /// Marks every downloadable file in this folder, or unmarks them when all are marked.
    fn toggle_all(&mut self) {
        let files: Vec<_> = self
            .files
            .iter()
            .filter(|f| !f.folder() && f.downloadable())
            .cloned()
            .collect();
        if files
            .iter()
            .all(|f| self.marked.iter().any(|m| m.id == f.id))
        {
            self.marked.retain(|m| !files.iter().any(|f| f.id == m.id));
        } else {
            for file in files {
                if !self.marked.iter().any(|m| m.id == file.id) {
                    self.marked.push(file);
                }
            }
        }
    }
    /// Drive allows duplicate names; give each job of this session its own output path.
    fn output_for(&self, dir: &Path, file: &File) -> PathBuf {
        let name = crate::api::safe_name(&file.name);
        let name = if file.workspace() {
            format!("{name}.pdf")
        } else {
            name
        };
        let taken = |p: &Path| {
            self.jobs
                .iter()
                .any(|j| j.file.id != file.id && j.output == p)
        };
        let first = dir.join(&name);
        if !taken(&first) {
            return first;
        }
        let path = Path::new(&name);
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        let ext = path.extension().map(|e| e.to_string_lossy());
        (2..)
            .map(|n| match &ext {
                Some(ext) => dir.join(format!("{stem} ({n}).{ext}")),
                None => dir.join(format!("{stem} ({n})")),
            })
            .find(|p| !taken(p))
            .unwrap()
    }
    /// Queues each file into its directory; returns the queued names and the number skipped.
    fn enqueue(&mut self, files: Vec<(File, PathBuf)>) -> (Vec<String>, usize) {
        let (mut added, mut skipped) = (Vec::new(), 0);
        for (file, dir) in files {
            if file.folder() || !file.downloadable() {
                skipped += 1;
                continue;
            }
            match self.jobs.iter().position(|j| j.file.id == file.id) {
                Some(i) if matches!(self.jobs[i].state, State::Queued | State::Active) => {
                    skipped += 1;
                    continue;
                }
                // Finished or failed earlier: queue it again at the end.
                Some(i) => {
                    let mut job = self.jobs.remove(i);
                    job.state = State::Queued;
                    self.jobs.push(job);
                }
                None => self.jobs.push(Job {
                    output: self.output_for(&dir, &file),
                    size: file.size.as_ref().and_then(|s| s.parse().ok()),
                    state: State::Queued,
                    file: file.clone(),
                }),
            }
            added.push(file.name);
        }
        (added, skipped)
    }
    fn retry_failed(&mut self) {
        let failed: Vec<_> = self
            .jobs
            .iter()
            .filter(|j| matches!(j.state, State::Failed(_)))
            .map(|j| (j.file.clone(), PathBuf::new()))
            .collect();
        self.status = if failed.is_empty() {
            "No failed downloads".into()
        } else {
            // Outputs are already assigned, so the directory is not consulted again.
            let (added, skipped) = self.enqueue(failed);
            queued(&added, skipped)
        };
    }
    fn clear_queue(&mut self) {
        let before = self.jobs.len();
        self.jobs.retain(|j| j.state != State::Queued);
        self.status = format!("Removed {} queued downloads", before - self.jobs.len());
    }
    fn count(&self, state: fn(&State) -> bool) -> usize {
        self.jobs.iter().filter(|j| state(&j.state)).count()
    }
    fn summary(&self) -> String {
        let done = self.count(|s| *s == State::Done);
        let failed = self.count(|s| matches!(s, State::Failed(_)));
        let mut text = format!("{done}/{} done", self.jobs.len());
        if failed > 0 {
            text += &format!(" · {failed} failed");
        }
        let total: u64 = self
            .jobs
            .iter()
            .filter(|j| !matches!(j.state, State::Failed(_)))
            .filter_map(|j| j.size)
            .sum();
        if total > 0 {
            let saved: u64 = self
                .jobs
                .iter()
                .filter(|j| j.state == State::Done)
                .filter_map(|j| j.size)
                .sum::<u64>()
                + self.active.as_ref().map_or(0, |a| a.stats.done);
            text += &format!(" · {} / {}", bytes(saved.min(total)), bytes(total));
        }
        text
    }
    fn draw(&mut self, frame: &mut Frame) {
        let waiting = self.jobs.len() - usize::from(self.active.is_some());
        let [header, browser, progress, footer] = Layout::vertical([
            Constraint::Length(2),
            Constraint::Min(3),
            Constraint::Length(6 + waiting.min(6) as u16),
            Constraint::Length(2),
        ])
        .areas(frame.area());
        let path = self
            .path
            .iter()
            .map(|(_, name)| name.as_str())
            .collect::<Vec<_>>()
            .join(" / ");
        let mut title = vec![
            " gdirect ".black().on_cyan().bold(),
            format!("  {path}").cyan(),
            format!("   {} connections / download", self.connections).gray(),
        ];
        if !self.marked.is_empty() {
            title.push(format!("   {} marked", self.marked.len()).yellow().bold());
        }
        frame.render_widget(Paragraph::new(Line::from(title)), header);
        let [list, preview] =
            Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)])
                .areas(browser);
        let items: Vec<_> = self
            .files
            .iter()
            .map(|f| {
                if f.folder() {
                    return ListItem::new(Line::from(vec![
                        if self.marked.iter().any(|m| m.id == f.id) {
                            " ● ".yellow().bold()
                        } else {
                            " ▸ ".cyan()
                        },
                        format!("{:>9}  ", "").into(),
                        f.name.clone().cyan(),
                    ]));
                }
                let icon = if self.marked.iter().any(|m| m.id == f.id) {
                    " ● ".yellow().bold()
                } else {
                    match self.job(&f.id).map(|j| &j.state) {
                        Some(State::Queued) => " ◦ ".gray(),
                        Some(State::Active) => " ↓ ".cyan().bold(),
                        Some(State::Done) => " ✓ ".green(),
                        Some(State::Failed(_)) => " ✗ ".red(),
                        None => "   ".into(),
                    }
                };
                let size = f
                    .size
                    .as_ref()
                    .and_then(|s| s.parse().ok())
                    .map(bytes)
                    .unwrap_or_default();
                let name = if f.downloadable() {
                    f.name.clone().white()
                } else {
                    f.name.clone().dark_gray()
                };
                ListItem::new(Line::from(vec![
                    icon,
                    format!("{size:>9}  ").dark_gray(),
                    name,
                ]))
            })
            .collect();
        let title = if self.loading {
            " Files · refreshing ".into()
        } else {
            format!(" Files · {} ", self.files.len())
        };
        frame.render_stateful_widget(
            List::new(items)
                .block(Block::bordered().title(title))
                .highlight_style(Style::default().bg(Color::DarkGray).bold())
                .highlight_symbol("›"),
            list,
            &mut self.selection,
        );
        let lines = match self.selected() {
            Some(file) if file.folder() => {
                let mut lines = vec![
                    Line::from(file.name.clone()).cyan().bold(),
                    Line::from("Folder · d downloads everything inside").cyan(),
                    Line::from(""),
                ];
                if self.preview_id.as_deref() == Some(&file.id) && self.preview.is_empty() {
                    lines.push(Line::from("Empty folder / loading…").dark_gray());
                }
                lines.extend(self.preview.iter().map(|f| {
                    Line::from(format!(
                        "{}{}",
                        if f.folder() { "▸ " } else { "  " },
                        f.name
                    ))
                }));
                lines
            }
            Some(file) => {
                let mut lines = vec![
                    Line::from(file.name.clone()).bold(),
                    Line::from(""),
                    Line::from(file.mime_type.clone()),
                    Line::from(format!(
                        "Size     {}",
                        file.size
                            .as_ref()
                            .and_then(|s| s.parse().ok())
                            .map(bytes)
                            .unwrap_or_else(|| "—".into())
                    )),
                    Line::from(format!(
                        "Modified {}",
                        file.modified_time.as_deref().unwrap_or("—")
                    )),
                    Line::from(""),
                ];
                lines.push(match self.job(&file.id) {
                    _ if !file.downloadable() => {
                        Line::from("Cannot be downloaded (shortcut, form, site or map)").dark_gray()
                    }
                    Some(job) => match &job.state {
                        State::Queued => Line::from("Queued").gray(),
                        State::Active => Line::from("Downloading…").cyan(),
                        State::Done => {
                            Line::from(format!("Saved {}", job.output.display())).green()
                        }
                        State::Failed(e) => Line::from(format!("Failed: {e}")).red(),
                    },
                    None if file.workspace() => Line::from("d  Export document as PDF").cyan(),
                    None => Line::from("d  Download   space  Mark").cyan(),
                });
                lines
            }
            None => vec![Line::from(if self.loading {
                "Loading Drive…"
            } else {
                "This folder is empty"
            })],
        };
        frame.render_widget(
            Paragraph::new(lines)
                .block(Block::bordered().title(" Preview "))
                .wrap(Wrap { trim: false }),
            preview,
        );
        let mut title = if self.jobs.is_empty() {
            " Downloads ".into()
        } else {
            format!(" Downloads · {} ", self.summary())
        };
        if self.listing > 0 {
            title += &format!("· listing {} folders ", self.listing);
        }
        let block = Block::bordered().title(title);
        let inner = block.inner(progress);
        frame.render_widget(block, progress);
        let [name, gauge, details, queue, message] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .areas(inner);
        if let Some((active, job)) = self
            .active
            .as_ref()
            .and_then(|a| Some((a, self.job(&a.id)?)))
        {
            let s = active.stats;
            let ratio = if s.total > 0 {
                (s.done as f64 / s.total as f64).clamp(0., 1.)
            } else {
                0.
            };
            let position = self.jobs.iter().position(|j| j.file.id == active.id);
            frame.render_widget(
                Paragraph::new(Line::from(vec![
                    format!("[{}/{}] ", position.map_or(0, |i| i + 1), self.jobs.len()).gray(),
                    job.file.name.clone().bold(),
                ])),
                name,
            );
            frame.render_widget(
                Gauge::default()
                    .gauge_style(Style::default().fg(Color::Cyan))
                    .ratio(ratio)
                    .label(if s.total > 0 {
                        format!("{:.1}%", ratio * 100.)
                    } else {
                        "Connecting…".into()
                    }),
                gauge,
            );
            let eta = s
                .total
                .saturating_sub(s.done)
                .checked_div(s.speed)
                .map(duration)
                .unwrap_or_else(|| "—".into());
            frame.render_widget(
                Paragraph::new(format!(
                    "{} / {}   {}/s   {} active connections   ETA {eta}",
                    bytes(s.done),
                    bytes(s.total),
                    bytes(s.speed),
                    s.connections
                )),
                details,
            );
        } else {
            frame.render_widget(
                Paragraph::new(if self.jobs.is_empty() {
                    "Ready · d downloads the selected file, space marks several"
                } else {
                    "Idle · d adds more, R retries failed downloads"
                })
                .dark_gray(),
                name,
            );
        }
        // Waiting work first, then failures, then the most recent successes.
        let mut others: Vec<&Job> = self
            .jobs
            .iter()
            .filter(|j| j.state == State::Queued)
            .collect();
        others.extend(
            self.jobs
                .iter()
                .filter(|j| matches!(j.state, State::Failed(_))),
        );
        others.extend(self.jobs.iter().rev().filter(|j| j.state == State::Done));
        let rows = queue.height as usize;
        let shown = if others.len() > rows {
            rows.saturating_sub(1)
        } else {
            rows
        };
        let mut lines: Vec<Line> = others
            .iter()
            .take(shown)
            .map(|job| {
                let size = job.size.map(bytes).unwrap_or_default();
                match &job.state {
                    State::Failed(e) => Line::from(vec![
                        " ✗ ".red(),
                        job.file.name.clone().into(),
                        format!("  {e}").red(),
                    ]),
                    State::Done => Line::from(vec![
                        " ✓ ".green(),
                        job.file.name.clone().gray(),
                        format!("  {size}").dark_gray(),
                    ]),
                    _ => Line::from(vec![
                        " ◦ ".gray(),
                        job.file.name.clone().into(),
                        format!("  {size}").dark_gray(),
                    ]),
                }
            })
            .collect();
        if others.len() > shown {
            lines.push(Line::from(format!("   … {} more", others.len() - shown)).dark_gray());
        }
        frame.render_widget(Paragraph::new(lines), queue);
        frame.render_widget(Paragraph::new(self.status.clone()).yellow(), message);
        frame.render_widget(Paragraph::new(" j/k move  h/l back/open  space mark  a mark all files  esc unmark  d download (folders too)  +/- connections\n r refresh  c cancel current  R retry failed  x clear queue  q quit (keeps partial data)"),footer);
    }
}
fn queued(added: &[String], skipped: usize) -> String {
    match (added, skipped) {
        ([], 0) => "Nothing to download".into(),
        ([], _) => "Nothing to download: already queued, or not downloadable".into(),
        ([name], 0) => format!("Queued {name}"),
        (names, 0) => format!("Queued {} files", names.len()),
        (names, skipped) => format!("Queued {} files, skipped {skipped}", names.len()),
    }
}
/// Lists every file below `folder`, paired with its directory relative to `folder`.
fn walk(
    list: impl Fn(&str) -> Result<Vec<File>>,
    folder: &str,
    progress: impl Fn(usize),
) -> Result<Vec<(File, PathBuf)>> {
    let mut files = Vec::new();
    let mut pending = VecDeque::from([(folder.to_owned(), PathBuf::new())]);
    // A folder can have several parents; list each one only once.
    let mut seen = HashSet::new();
    while let Some((id, dir)) = pending.pop_front() {
        if !seen.insert(id.clone()) {
            continue;
        }
        for file in list(&id)? {
            if file.folder() {
                let sub = dir.join(crate::api::safe_name(&file.name));
                pending.push_back((file.id.clone(), sub));
            } else {
                files.push((file, dir.clone()));
            }
        }
        progress(files.len());
    }
    Ok(files)
}
fn duration(seconds: u64) -> String {
    match seconds {
        0..60 => format!("{seconds}s"),
        60..3600 => format!("{}m{:02}s", seconds / 60, seconds % 60),
        _ => format!("{}h{:02}m", seconds / 3600, seconds % 3600 / 60),
    }
}
fn bytes(n: u64) -> String {
    if n >= 1 << 30 {
        format!("{:.1} GiB", n as f64 / (1u64 << 30) as f64)
    } else if n >= 1 << 20 {
        format!("{:.1} MiB", n as f64 / (1u64 << 20) as f64)
    } else if n >= 1 << 10 {
        format!("{:.1} KiB", n as f64 / 1024.)
    } else {
        format!("{n} B")
    }
}
fn fetch(api: &Api, tx: &Sender<Message>, id: String, preview: bool) {
    let api = api.clone();
    let tx = tx.clone();
    thread::spawn(move || {
        let result = api.list(&id).map_err(|e| format!("{e:#}"));
        let _ = tx.send(if preview {
            Message::Preview(id, result)
        } else {
            Message::Folder(id, result)
        });
    });
}
/// Lists a folder tree in the background; its files are queued under `dir/<folder name>`.
fn download_folder(api: &Api, tx: &Sender<Message>, folder: File, dir: &Path) {
    let api = api.clone();
    let tx = tx.clone();
    let root = dir.join(crate::api::safe_name(&folder.name));
    thread::spawn(move || {
        let name = folder.name;
        let result = walk(
            |id| api.list(id),
            &folder.id,
            |count| {
                let _ = tx.send(Message::Listing(name.clone(), count));
            },
        )
        .map(|files| {
            files
                .into_iter()
                .map(|(file, sub)| (file, root.join(sub)))
                .collect()
        })
        .map_err(|e| format!("{e:#}"));
        let _ = tx.send(Message::Listed(name, result));
    });
}
fn start(api: &Api, options: &Options, tx: &Sender<Message>, job: &Job, connections: u8) -> Active {
    let (progress_tx, rx) = mpsc::channel();
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancel.clone();
    let api = api.clone();
    let tx = tx.clone();
    let id = job.file.id.clone();
    let mut args = download::Args {
        file: id.clone(),
        output: job.output.clone(),
        ip: options.ip,
        sni: options.sni.clone(),
        token: None,
        export: job.file.workspace().then(|| "application/pdf".into()),
        md5: job.file.md5_checksum.clone(),
        connections,
        ca_cert: options.ca_cert.clone(),
    };
    let worker_id = id.clone();
    let worker = thread::spawn(move || {
        let result = (|| -> Result<()> {
            args.token = Some(api.download_token()?);
            if worker_cancel.load(Ordering::Relaxed) {
                anyhow::bail!("Cancelled");
            }
            let result = download::run(
                args,
                Some(&mut download::Progress {
                    tx: progress_tx,
                    cancel: worker_cancel.clone(),
                }),
            );
            if worker_cancel.load(Ordering::Relaxed) {
                anyhow::bail!("Cancelled; partial download saved");
            }
            result
        })()
        .map_err(|e| format!("{e:#}"));
        let _ = tx.send(Message::Finished(worker_id, result));
    });
    Active {
        id,
        stats: Stats::default(),
        rx,
        cancel,
        worker,
    }
}
pub fn run(api: Api, options: Options) -> Result<()> {
    ensure!(
        std::io::stdin().is_terminal() && std::io::stdout().is_terminal(),
        "browse needs a terminal; use gdirect ls --json for scripts"
    );
    api.token()?;
    let mut terminal = ratatui::try_init()?;
    let result = event_loop(&mut terminal, api, options);
    ratatui::restore();
    result
}
fn event_loop(terminal: &mut ratatui::DefaultTerminal, api: Api, options: Options) -> Result<()> {
    let (tx, rx) = mpsc::channel();
    let db = Store::open(&api.db)?;
    let initial = api.cached(&options.folder)?;
    let folder_name = if options.folder == "root" {
        "My Drive".to_owned()
    } else {
        api.metadata(&options.folder)?.name
    };
    let mut view = View::new(
        (options.folder.clone(), folder_name),
        initial,
        options.connections,
    );
    fetch(&api, &tx, options.folder.clone(), false);
    let mut changed = Instant::now();
    let result = (|| -> Result<()> {
        loop {
            while let Ok(message) = rx.try_recv() {
                match message {
                    Message::Folder(id, result)
                        if view.path.last().is_some_and(|(current, _)| current == &id) =>
                    {
                        view.loading = false;
                        match result {
                            Ok(files) => {
                                view.files = files;
                                view.selection.select(if view.files.is_empty() {
                                    None
                                } else {
                                    Some(0)
                                });
                                view.preview_id = None;
                                view.status.clear();
                                changed = Instant::now();
                            }
                            Err(e) => view.status = e,
                        }
                    }
                    Message::Preview(id, result) if view.selected().is_some_and(|f| f.id == id) => {
                        match result {
                            Ok(files) => view.preview = files,
                            Err(e) => view.status = e,
                        }
                    }
                    Message::Listing(name, count) => {
                        view.status = format!("Listing {name}… {count} files");
                    }
                    Message::Listed(name, result) => {
                        view.listing -= 1;
                        view.status = match result {
                            Ok(files) if files.is_empty() => format!("{name} has no files"),
                            Ok(files) => {
                                let (added, skipped) = view.enqueue(files);
                                format!("{name}: {}", queued(&added, skipped))
                            }
                            Err(e) => format!("Could not list {name}: {e}"),
                        };
                    }
                    Message::Finished(id, result) => {
                        if let Some(active) = view.active.take_if(|a| a.id == id) {
                            let _ = active.worker.join();
                        }
                        if let Some(job) = view.job_mut(&id) {
                            let name = job.file.name.clone();
                            job.state = match result {
                                Ok(()) => State::Done,
                                Err(e) => State::Failed(e),
                            };
                            view.status = match &job.state {
                                State::Failed(e) => format!("{name}: {e}"),
                                _ => format!("Saved {name}"),
                            };
                        }
                        if !view.jobs.iter().any(|j| j.state == State::Queued) {
                            view.status = format!("Finished · {}", view.summary());
                        }
                    }
                    _ => {}
                }
            }
            if let Some(active) = &mut view.active {
                while let Ok(stats) = active.rx.try_recv() {
                    active.stats = stats;
                }
            }
            if view.active.is_none() {
                if view.quitting {
                    break;
                }
                if let Some(job) = view.jobs.iter_mut().find(|j| j.state == State::Queued) {
                    job.state = State::Active;
                    view.active = Some(start(&api, &options, &tx, job, view.connections));
                }
            }
            if changed.elapsed() > Duration::from_millis(200)
                && !view.loading
                && let Some(file) = view.selected().filter(|f| f.folder())
            {
                let id = file.id.clone();
                if view.preview_id.as_deref() != Some(&id) {
                    view.preview = api.cached(&id).unwrap_or_default();
                    view.preview_id = Some(id.clone());
                    fetch(&api, &tx, id, true);
                }
            }
            terminal.draw(|frame| view.draw(frame))?;
            if !event::poll(Duration::from_millis(80))? {
                continue;
            }
            let Event::Key(key) = event::read()? else {
                continue;
            };
            if key.kind != KeyEventKind::Press {
                continue;
            }
            if view.quitting {
                continue;
            }
            match key.code {
                KeyCode::Char('q') | KeyCode::Char('c')
                    if key.code == KeyCode::Char('q')
                        || key.modifiers.contains(KeyModifiers::CONTROL) =>
                {
                    view.quitting = true;
                    view.jobs.retain(|j| j.state != State::Queued);
                    view.status = "Stopping download…".into();
                    if let Some(active) = &view.active {
                        active.cancel.store(true, Ordering::Relaxed);
                    }
                }
                KeyCode::Char('c') => {
                    if let Some(active) = &view.active {
                        active.cancel.store(true, Ordering::Relaxed);
                        view.status = "Cancelling…".into();
                    }
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    view.move_by(1);
                    changed = Instant::now();
                }
                KeyCode::Up | KeyCode::Char('k') => {
                    view.move_by(-1);
                    changed = Instant::now();
                }
                KeyCode::Char('+') | KeyCode::Char('=') => {
                    view.connections = (view.connections + 1).min(16);
                    db.set("connections", &view.connections.to_string())?;
                }
                KeyCode::Char('-') => {
                    view.connections = view.connections.saturating_sub(1).max(1);
                    db.set("connections", &view.connections.to_string())?;
                }
                KeyCode::Enter | KeyCode::Right | KeyCode::Char('l') => {
                    if let Some(file) = view.selected().filter(|f| f.folder()).cloned() {
                        view.path.push((file.id.clone(), file.name));
                        view.files = api.cached(&file.id).unwrap_or_default();
                        view.selection.select(Some(0));
                        view.preview.clear();
                        view.preview_id = None;
                        view.loading = true;
                        fetch(&api, &tx, file.id, false);
                    }
                }
                KeyCode::Left | KeyCode::Backspace | KeyCode::Char('h') => {
                    if view.path.len() > 1 {
                        view.path.pop();
                        let id = view.path.last().unwrap().0.clone();
                        view.files = api.cached(&id).unwrap_or_default();
                        view.selection.select(Some(0));
                        view.preview.clear();
                        view.preview_id = None;
                        view.loading = true;
                        fetch(&api, &tx, id, false);
                    }
                }
                KeyCode::Char('r') => {
                    view.loading = true;
                    fetch(&api, &tx, view.path.last().unwrap().0.clone(), false);
                }
                KeyCode::Char(' ') => view.toggle_mark(),
                KeyCode::Char('a') => view.toggle_all(),
                KeyCode::Esc => view.marked.clear(),
                KeyCode::Char('d') => {
                    let picked: Vec<File> = if view.marked.is_empty() {
                        view.selected().cloned().into_iter().collect()
                    } else {
                        std::mem::take(&mut view.marked)
                    };
                    let (folders, files): (Vec<_>, Vec<_>) =
                        picked.into_iter().partition(|f| f.folder());
                    if !files.is_empty() || folders.is_empty() {
                        let files = files
                            .into_iter()
                            .map(|f| (f, options.output.clone()))
                            .collect();
                        let (added, skipped) = view.enqueue(files);
                        view.status = queued(&added, skipped);
                    }
                    for folder in folders {
                        view.status = format!("Listing {}…", folder.name);
                        view.listing += 1;
                        download_folder(&api, &tx, folder, &options.output);
                    }
                }
                KeyCode::Char('R') => view.retry_failed(),
                KeyCode::Char('x') => view.clear_queue(),
                _ => {}
            }
        }
        Ok(())
    })();
    // Always stop/join the native worker before restoring the terminal, even on I/O failure.
    if let Some(active) = view.active.take() {
        active.cancel.store(true, Ordering::Relaxed);
        let _ = active.worker.join();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn file(id: &str, name: &str, mime_type: &str) -> File {
        File {
            id: id.into(),
            name: name.into(),
            mime_type: mime_type.into(),
            size: Some("1048576".into()),
            modified_time: None,
            md5_checksum: None,
            resource_key: None,
        }
    }
    fn render(view: &mut View, w: u16, h: u16) -> Vec<String> {
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(w, h)).unwrap();
        terminal.draw(|f| view.draw(f)).unwrap();
        let buffer = terminal.backend().buffer();
        (0..h)
            .map(|y| (0..w).map(|x| buffer[(x, y)].symbol()).collect())
            .collect()
    }
    #[test]
    fn layout_has_browser_above_downloads() {
        let folder = file("folder", "Documents", "application/vnd.google-apps.folder");
        let mut view = View::new(("root".into(), "My Drive".into()), vec![folder], 8);
        view.loading = false;
        for (w, h) in [(100, 30), (40, 15)] {
            let rows = render(&mut view, w, h);
            let files = rows.iter().position(|s| s.contains("Files")).unwrap();
            let downloads = rows.iter().position(|s| s.contains("Downloads")).unwrap();
            assert!(downloads > files);
            assert!(rows.iter().any(|s| s.contains("Documents")));
        }
    }
    #[test]
    fn marked_files_are_queued_together() {
        let files = vec![
            file("a", "a.bin", "application/octet-stream"),
            file("dir", "dir", "application/vnd.google-apps.folder"),
            file("b", "b.bin", "application/octet-stream"),
            file("form", "Form", "application/vnd.google-apps.form"),
        ];
        let mut view = View::new(("root".into(), "My Drive".into()), files, 8);
        view.toggle_all();
        assert_eq!(view.marked.len(), 2);
        let marked = std::mem::take(&mut view.marked);
        let (added, skipped) =
            view.enqueue(marked.into_iter().map(|f| (f, "out".into())).collect());
        assert_eq!(queued(&added, skipped), "Queued 2 files");
        let (added, skipped) = view.enqueue(vec![(view.files[0].clone(), "out".into())]);
        assert_eq!(
            (added.len(), skipped),
            (0, 1),
            "queued files are not added twice"
        );
        assert_eq!(view.jobs.len(), 2);
        view.jobs[0].state = State::Failed("boom".into());
        view.jobs[1].state = State::Done;
        assert!(view.summary().starts_with("1/2 done · 1 failed"));
        let rows = render(&mut view, 100, 30);
        assert!(rows.iter().any(|s| s.contains("✗ a.bin  boom")));
        assert!(rows.iter().any(|s| s.contains("✓ b.bin")));
        view.retry_failed();
        assert_eq!(view.jobs.last().unwrap().file.id, "a");
        assert_eq!(view.jobs.last().unwrap().state, State::Queued);
        view.clear_queue();
        assert_eq!(view.jobs.len(), 1);
    }
    #[test]
    fn duplicate_names_get_distinct_outputs() {
        let mut view = View::new(("root".into(), "My Drive".into()), vec![], 8);
        view.enqueue(
            [
                file("1", "report.pdf", "application/pdf"),
                file("2", "report.pdf", "application/pdf"),
                file("3", "report.pdf", "application/pdf"),
                file("4", "notes", "application/vnd.google-apps.document"),
                file("5", "notes.pdf", "application/pdf"),
            ]
            .into_iter()
            .map(|f| (f, "out".into()))
            .collect(),
        );
        let outputs: Vec<_> = view.jobs.iter().map(|j| j.output.clone()).collect();
        assert_eq!(
            outputs,
            [
                "report.pdf",
                "report (2).pdf",
                "report (3).pdf",
                "notes.pdf",
                "notes (2).pdf"
            ]
            .map(|name| Path::new("out").join(name))
        );
    }
    #[test]
    fn folders_are_walked_recursively() {
        let dir = "application/vnd.google-apps.folder";
        let tree = |id: &str| -> Result<Vec<File>> {
            Ok(match id {
                "root" => vec![
                    file("sub", "Sub/Dir", dir),
                    file("a", "a.bin", "application/octet-stream"),
                ],
                // A folder reachable twice is listed once.
                "sub" => vec![
                    file("deep", "Deep", dir),
                    file("again", "Deep", dir),
                    file("b", "b.bin", "application/octet-stream"),
                ],
                "deep" | "again" => vec![
                    file("c", "c.bin", "application/octet-stream"),
                    file("sub", "Sub/Dir", dir),
                ],
                _ => anyhow::bail!("unknown folder {id}"),
            })
        };
        let counts = std::cell::RefCell::new(vec![]);
        let files = walk(tree, "root", |n| counts.borrow_mut().push(n)).unwrap();
        let found: Vec<_> = files
            .iter()
            .map(|(f, d)| (f.id.as_str(), d.clone()))
            .collect();
        let sub = PathBuf::from("Sub_Dir");
        assert_eq!(
            found,
            [
                ("a", PathBuf::new()),
                ("b", sub.clone()),
                ("c", sub.join("Deep")),
                ("c", sub.join("Deep")),
            ]
        );
        assert_eq!(counts.into_inner(), [1, 2, 3, 4]);
        assert!(walk(|_| anyhow::bail!("offline"), "root", |_| {}).is_err());
        // The same file found twice is queued once.
        let mut view = View::new(("root".into(), "My Drive".into()), vec![], 8);
        let (added, skipped) = view.enqueue(files);
        assert_eq!((added.len(), skipped), (3, 1));
    }
}
