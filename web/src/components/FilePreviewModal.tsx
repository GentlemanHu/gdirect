import React, { useEffect, useState, useRef } from 'react';
import {
  Check,
  Code,
  Copy,
  Download,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  Music,
  RotateCw,
  Search,
  Table,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { renderAsync as renderDocx } from 'docx-preview';
import { DriveFile, SystemStatus } from '../types';
import { PlayerModal } from './PlayerModal';
import { copyToClipboard } from '../utils/clipboard';

interface FilePreviewModalProps {
  file: DriveFile;
  status: SystemStatus | null;
  folderFiles?: DriveFile[];
  onClose: () => void;
  onSelectFile?: (file: DriveFile) => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  status,
  folderFiles,
  onClose,
  onSelectFile,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Text/Code/JSON/IPYNB state
  const [textContent, setTextContent] = useState<string | null>(null);
  const [ipynbCells, setIpynbCells] = useState<any[] | null>(null);

  // Spreadsheet (XLSX / CSV) state
  const [sheetsData, setSheetsData] = useState<{ [name: string]: any[][] } | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [sheetSearch, setSheetSearch] = useState('');

  // Image viewer state
  const [imageScale, setImageScale] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);

  // DOCX viewer container ref
  const docxContainerRef = useRef<HTMLDivElement>(null);

  const key = localStorage.getItem('gdirect_api_key');
  const tokenParam = key ? `?token=${encodeURIComponent(key)}` : '';
  const fileUrl = `${window.location.origin}/d/${file.id}/${encodeURIComponent(file.name)}${tokenParam}`;

  const name = file.name.toLowerCase();
  const ext = name.substring(name.lastIndexOf('.') + 1);

  // Identify file categories
  const isVideo =
    file.mimeType.startsWith('video/') ||
    ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v'].includes(ext);

  const isAudio =
    file.mimeType.startsWith('audio/') ||
    ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus'].includes(ext);

  const isImage =
    file.mimeType.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext);

  const isPdf = file.mimeType === 'application/pdf' || ext === 'pdf';

  const isGoogleDoc = file.mimeType === 'application/vnd.google-apps.document';
  const isGooglePresentation = file.mimeType === 'application/vnd.google-apps.presentation';
  const isGoogleSpreadsheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';

  const isDocx = ext === 'docx';
  const isPptx = ext === 'pptx' || ext === 'ppt';
  const isSpreadsheet =
    isGoogleSpreadsheet || ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);

  const isIpynb = ext === 'ipynb';

  const isTextOrCode =
    !isIpynb &&
    (file.mimeType.startsWith('text/') ||
      [
        'txt',
        'md',
        'json',
        'js',
        'jsx',
        'ts',
        'tsx',
        'rs',
        'py',
        'sh',
        'bash',
        'yml',
        'yaml',
        'toml',
        'xml',
        'html',
        'css',
        'scss',
        'sql',
        'log',
        'env',
        'ini',
        'conf',
      ].includes(ext));

  // If video, use full Cinema Player
  if (isVideo) {
    return (
      <PlayerModal
        file={file}
        status={status}
        folderFiles={folderFiles}
        onClose={onClose}
        onSelectFile={onSelectFile}
      />
    );
  }

  // Load and parse file content based on type
  useEffect(() => {
    setLoading(true);
    setErrorMsg(null);

    // 1. Google Doc / Presentation -> stream as exported PDF
    if (isGoogleDoc || isGooglePresentation) {
      setLoading(false);
      return;
    }

    // 2. Spreadsheets (Excel / CSV / Google Sheets)
    if (isSpreadsheet) {
      const url = isGoogleSpreadsheet ? `${fileUrl}&export=xlsx` : fileUrl;
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buffer) => {
          const workbook = XLSX.read(buffer, { type: 'array' });
          const names = workbook.SheetNames;
          setSheetNames(names);
          if (names.length > 0) setActiveSheet(names[0]);

          const dataMap: { [name: string]: any[][] } = {};
          names.forEach((sName) => {
            const worksheet = workbook.Sheets[sName];
            const rows = XLSX.utils.sheet_to_json(worksheet, {
              header: 1,
              defval: '',
            }) as any[][];
            dataMap[sName] = rows;
          });
          setSheetsData(dataMap);
        })
        .catch((e) => setErrorMsg(`无法解析表格文件: ${e.message}`))
        .finally(() => setLoading(false));
      return;
    }

    // 3. DOCX (Word Document)
    if (isDocx) {
      fetch(fileUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buffer) => {
          if (docxContainerRef.current) {
            renderDocx(buffer, docxContainerRef.current, undefined, {
              className: 'docx-rendered',
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: false,
            });
          }
        })
        .catch((e) => setErrorMsg(`无法渲染 Word 文档: ${e.message}`))
        .finally(() => setLoading(false));
      return;
    }

    // 4. Jupyter / Colab Notebook (.ipynb)
    if (isIpynb) {
      fetch(fileUrl)
        .then((res) => res.json())
        .then((data) => {
          setIpynbCells(data.cells || []);
        })
        .catch((e) => setErrorMsg(`无法解析 Notebook JSON: ${e.message}`))
        .finally(() => setLoading(false));
      return;
    }

    // 5. Plain Text / Code
    if (isTextOrCode) {
      fetch(fileUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => setTextContent(text))
        .catch((e) => setErrorMsg(`无法读取文本内容: ${e.message}`))
        .finally(() => setLoading(false));
      return;
    }

    // Default (Image, PDF, Audio, Binary)
    setLoading(false);
  }, [file.id, fileUrl]);

  const formatSize = (sizeStr?: string) => {
    if (!sizeStr) return '-';
    const bytes = parseInt(sizeStr, 10);
    if (isNaN(bytes)) return '-';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const handleCopyLink = () => {
    copyToClipboard(fileUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = file.name;
    a.click();
  };

  // Convert column number to Excel column letters (0 -> A, 1 -> B, 26 -> AA)
  const getColLetter = (index: number) => {
    let letter = '';
    let temp = index;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  };

  const currentRows = (sheetsData && activeSheet && sheetsData[activeSheet]) || [];
  const filteredRows = sheetSearch.trim()
    ? currentRows.filter((row) =>
        row.some((cell) => String(cell).toLowerCase().includes(sheetSearch.toLowerCase()))
      )
    : currentRows;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/90 backdrop-blur-xl animate-fade-in select-none">
      <div className="w-full max-w-6xl h-[90vh] rounded-2xl glass-panel border border-slate-800 flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-14 px-4 sm:px-6 border-b border-slate-800 bg-slate-950 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shrink-0">
              {isImage ? (
                <ImageIcon className="w-4 h-4" />
              ) : isAudio ? (
                <Music className="w-4 h-4" />
              ) : isSpreadsheet ? (
                <FileSpreadsheet className="w-4 h-4" />
              ) : isPdf || isGoogleDoc || isGooglePresentation ? (
                <FileText className="w-4 h-4" />
              ) : isIpynb || isTextOrCode ? (
                <Code className="w-4 h-4" />
              ) : (
                <File className="w-4 h-4" />
              )}
            </div>
            <div className="overflow-hidden">
              <h3 className="text-sm font-semibold text-white truncate" title={file.name}>
                {file.name}
              </h3>
              <p className="text-[11px] text-slate-400">
                {formatSize(file.size)} • {file.mimeType}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleCopyLink}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition-colors flex items-center space-x-1.5"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copiedUrl ? '已复制' : '复制直链'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-black/40 flex flex-col relative">
          {errorMsg && (
            <div className="m-4 p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
              {errorMsg}
            </div>
          )}

          {/* 1. Spreadsheet Viewer (Excel / CSV / Google Sheets) */}
          {isSpreadsheet && !errorMsg && (
            <div className="w-full h-full flex flex-col bg-slate-950">
              {/* Sheet Bar & Search */}
              <div className="h-11 px-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between shrink-0 text-xs">
                {/* Sheet Tabs */}
                <div className="flex items-center space-x-1 overflow-x-auto">
                  {sheetNames.map((sName) => (
                    <button
                      key={sName}
                      onClick={() => setActiveSheet(sName)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                        activeSheet === sName
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {sName}
                    </button>
                  ))}
                </div>

                {/* Filter in sheet */}
                <div className="relative w-44">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="表格内搜索..."
                    value={sheetSearch}
                    onChange={(e) => setSheetSearch(e.target.value)}
                    className="w-full pl-8 pr-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Table Grid */}
              <div className="flex-1 overflow-auto">
                {loading ? (
                  <div className="p-12 text-center text-xs text-slate-500">正在解析表格数据...</div>
                ) : filteredRows.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-500">表格为空或无搜索匹配</div>
                ) : (
                  <table className="w-full border-collapse text-left font-mono text-xs text-slate-300">
                    <thead className="sticky top-0 bg-slate-900 z-10 border-b border-slate-800 text-[11px] text-slate-400 select-none">
                      <tr>
                        <th className="w-12 py-2 px-2 text-center bg-slate-900 border-r border-slate-800">#</th>
                        {filteredRows[0]?.map((_, colIdx) => (
                          <th key={colIdx} className="py-2 px-3 border-r border-slate-800 font-semibold text-slate-400 min-w-[100px]">
                            {getColLetter(colIdx)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {filteredRows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-slate-900/60 transition-colors">
                          <td className="py-1.5 px-2 text-center text-slate-600 bg-slate-950/80 border-r border-slate-800 font-medium select-none">
                            {rIdx + 1}
                          </td>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="py-1.5 px-3 border-r border-slate-800/40 whitespace-pre-wrap break-words max-w-xs">
                              {cell !== null && cell !== undefined ? String(cell) : ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* 2. DOCX Word Document Viewer */}
          {isDocx && !errorMsg && (
            <div className="flex-1 overflow-auto p-4 sm:p-8 flex justify-center bg-slate-900">
              <div
                ref={docxContainerRef}
                className="w-full max-w-4xl bg-white text-slate-900 p-8 rounded-xl shadow-2xl min-h-[500px]"
              />
            </div>
          )}

          {/* 3. Jupyter / Google Colab Notebook Viewer (.ipynb) */}
          {isIpynb && !errorMsg && (
            <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full">
              {loading ? (
                <div className="p-12 text-center text-xs text-slate-500">正在解析 Notebook...</div>
              ) : (
                ipynbCells?.map((cell, idx) => {
                  const isCode = cell.cell_type === 'code';
                  const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source || '';

                  return (
                    <div key={idx} className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950">
                      {/* Cell input */}
                      <div className="p-3 bg-slate-900/60 font-mono text-xs text-slate-200 whitespace-pre-wrap border-b border-slate-800 flex items-start space-x-3">
                        <span className="text-[11px] text-cyan-400 select-none shrink-0 font-bold">
                          {isCode ? `[${cell.execution_count ?? ' '}]:` : 'MD:'}
                        </span>
                        <div className="flex-1 overflow-x-auto">{source}</div>
                      </div>

                      {/* Cell outputs (if code) */}
                      {isCode && cell.outputs?.length > 0 && (
                        <div className="p-3 space-y-2 bg-black/50 border-t border-slate-900 font-mono text-xs">
                          {cell.outputs.map((out: any, oIdx: number) => {
                            // Text stream
                            if (out.text) {
                              const txt = Array.isArray(out.text) ? out.text.join('') : out.text;
                              return (
                                <div key={oIdx} className="text-slate-300 whitespace-pre-wrap">
                                  {txt}
                                </div>
                              );
                            }
                            // Image output (e.g. Matplotlib plot)
                            if (out.data && out.data['image/png']) {
                              return (
                                <img
                                  key={oIdx}
                                  src={`data:image/png;base64,${out.data['image/png']}`}
                                  alt="Plot output"
                                  className="max-w-full rounded bg-white p-2"
                                />
                              );
                            }
                            // Execution result text
                            if (out.data && out.data['text/plain']) {
                              const txt = Array.isArray(out.data['text/plain'])
                                ? out.data['text/plain'].join('')
                                : out.data['text/plain'];
                              return (
                                <div key={oIdx} className="text-slate-400 whitespace-pre-wrap">
                                  {txt}
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* 4. PDF & Google Docs / Slides Viewer */}
          {(isPdf || isGoogleDoc || isGooglePresentation) && !errorMsg && (
            <iframe
              src={
                isGoogleDoc || isGooglePresentation
                  ? `${fileUrl}&export=pdf`
                  : fileUrl
              }
              title={file.name}
              className="w-full h-full border-none bg-white"
            />
          )}

          {/* 5. Image Viewer */}
          {isImage && !errorMsg && (
            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
              <div className="absolute top-3 right-3 z-10 flex items-center space-x-1 bg-slate-950/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 text-slate-300 text-xs">
                <button
                  onClick={() => setImageScale((s) => Math.max(0.2, s - 0.2))}
                  className="p-1.5 hover:bg-slate-800 rounded-lg"
                  title="缩小"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="font-mono px-2 text-[11px] text-cyan-300">
                  {Math.round(imageScale * 100)}%
                </span>
                <button
                  onClick={() => setImageScale((s) => Math.min(3, s + 0.2))}
                  className="p-1.5 hover:bg-slate-800 rounded-lg"
                  title="放大"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setImageRotation((r) => (r + 90) % 360)}
                  className="p-1.5 hover:bg-slate-800 rounded-lg"
                  title="旋转 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>

              <img
                src={fileUrl}
                alt={file.name}
                style={{
                  transform: `scale(${imageScale}) rotate(${imageRotation}deg)`,
                  transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
              />
            </div>
          )}

          {/* 6. Audio Player */}
          {isAudio && !errorMsg && (
            <div className="m-auto w-full max-w-md p-6 rounded-2xl glass-panel border border-slate-800 shadow-2xl space-y-4 text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 flex items-center justify-center">
                <Music className="w-8 h-8 animate-pulse" />
              </div>
              <h4 className="text-sm font-semibold text-white truncate">{file.name}</h4>
              <audio controls src={fileUrl} className="w-full" autoPlay />
            </div>
          )}

          {/* 7. Code / Text Viewer */}
          {isTextOrCode && !errorMsg && (
            <div className="w-full h-full flex flex-col bg-slate-950">
              <div className="p-2.5 px-4 bg-slate-900 border-b border-slate-800 text-xs font-mono text-slate-400 flex items-center justify-between">
                <span>{ext.toUpperCase()} 源码</span>
                <button
                  onClick={() => {
                    if (textContent) {
                      copyToClipboard(textContent);
                      alert('已复制全文到剪贴板！');
                    }
                  }}
                  className="hover:text-cyan-300 transition-colors"
                >
                  复制全文
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 font-mono text-xs text-slate-200 whitespace-pre-wrap select-text">
                {loading ? '正在加载文本内容...' : textContent}
              </div>
            </div>
          )}

          {/* 8. PPTX / Binary / Archive Fallback */}
          {!isImage &&
            !isAudio &&
            !isPdf &&
            !isGoogleDoc &&
            !isGooglePresentation &&
            !isSpreadsheet &&
            !isDocx &&
            !isIpynb &&
            !isTextOrCode &&
            !errorMsg && (
              <div className="m-auto w-full max-w-md p-8 rounded-2xl glass-panel border border-slate-800 text-center space-y-4 shadow-2xl">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                  <File className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-white truncate">{file.name}</h4>
                  <p className="text-xs text-slate-400 mt-1">支持高速原文件直接下载</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono space-y-1 text-left">
                  <p>文件大小: {formatSize(file.size)}</p>
                  <p>文件类型: {file.mimeType || '未知'}</p>
                </div>
                <button
                  onClick={handleDownload}
                  className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md transition-all flex items-center justify-center space-x-2"
                >
                  <Download className="w-4 h-4" />
                  <span>立即下载文件</span>
                </button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};
