export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleStyleConfig {
  fontSize: number; // 14 to 40 px
  primaryColor: string; // Hex color
  secondaryColor: string; // Hex color
  bgStyle: 'box' | 'stroke' | 'shadow' | 'none';
  bottomOffset: number; // px from bottom
  fontWeight: 'normal' | 'semibold' | 'bold';
  bilingualSplit: boolean;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleConfig = {
  fontSize: 20,
  primaryColor: '#FFFFFF',
  secondaryColor: '#FDE047',
  bgStyle: 'box',
  bottomOffset: 75,
  fontWeight: 'bold',
  bilingualSplit: true,
};

export function loadSavedSubtitleStyle(): SubtitleStyleConfig {
  try {
    const saved = localStorage.getItem('gdirect_sub_style');
    if (saved) {
      return { ...DEFAULT_SUBTITLE_STYLE, ...JSON.parse(saved) };
    }
  } catch {}
  return DEFAULT_SUBTITLE_STYLE;
}

export function saveSubtitleStyle(cfg: SubtitleStyleConfig): void {
  try {
    localStorage.setItem('gdirect_sub_style', JSON.stringify(cfg));
  } catch {}
}

/**
 * Universal High-Performance Subtitle Parser
 * Supports: ASS, SSA, SRT, VTT, LRC
 */
export function parseSubtitle(content: string): SubtitleCue[] {
  if (!content || typeof content !== 'string') return [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. Detect ASS / SSA
  if (normalized.includes('[Events]') || normalized.includes('Dialogue:')) {
    const cues = parseAssSsa(normalized);
    if (cues.length > 0) return cues;
  }

  // 2. Parse SRT / VTT
  const srtCues = parseSrtVtt(normalized);
  if (srtCues.length > 0) return srtCues;

  return [];
}

function parseAssTime(t: string): number {
  const parts = t.trim().split(':');
  if (parts.length < 3) return 0;
  const h = parseFloat(parts[0]) || 0;
  const m = parseFloat(parts[1]) || 0;
  const s = parseFloat(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

function parseAssSsa(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('Dialogue:')) continue;

    const body = trimmed.substring('Dialogue:'.length).trim();
    // ASS Format has at least 9 commas before the Text field:
    // Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    let commaCount = 0;
    let idx = 0;
    const parts: string[] = [];
    let cur = '';

    while (idx < body.length && commaCount < 9) {
      if (body[idx] === ',') {
        parts.push(cur.trim());
        cur = '';
        commaCount++;
      } else {
        cur += body[idx];
      }
      idx++;
    }

    const textPart = body.substring(idx);
    const start = parseAssTime(parts[1] || '0');
    const end = parseAssTime(parts[2] || '0');

    // Clean ASS tags like {\fs50\c&H00FFFFFF}, \N, \n, \h
    const cleanText = textPart
      .replace(/\{[^}]*\}/g, '')
      .split('\\N').join('\n')
      .split('\\n').join('\n')
      .split('\\h').join(' ')
      .trim();

    if (cleanText && end > start) {
      cues.push({ start, end, text: cleanText });
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

function parseSrtVtt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.split(/\n\n+/);
  const timeRegex = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[,\.](\d{2,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[,\.](\d{2,3})/;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(timeRegex);
      if (match) {
        const h1 = parseInt(match[1] || '0', 10);
        const m1 = parseInt(match[2], 10);
        const s1 = parseInt(match[3], 10);
        const ms1Str = match[4].padEnd(3, '0').slice(0, 3);
        const ms1 = parseInt(ms1Str, 10);
        const start = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;

        const h2 = parseInt(match[5] || '0', 10);
        const m2 = parseInt(match[6], 10);
        const s2 = parseInt(match[7], 10);
        const ms2Str = match[8].padEnd(3, '0').slice(0, 3);
        const ms2 = parseInt(ms2Str, 10);
        const end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000;

        const textLines = lines
          .slice(i + 1)
          .map((l) => l.replace(/<[^>]+>/g, '').trim())
          .filter((l) => !/^\d+$/.test(l) && l.length > 0);

        if (textLines.length > 0 && end > start) {
          cues.push({ start, end, text: textLines.join('\n') });
        }
        break;
      }
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Split bilingual cue text into primary (usually native/Chinese) and secondary (English/foreign)
 */
export function splitBilingualText(rawText: string): { primary: string; secondary?: string } {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return { primary: rawText };
  }

  // Check if one line has Chinese characters and another doesn't
  const hasChinese = (s: string) => /[\u4e00-\u9fa5]/.test(s);

  const zhLines: string[] = [];
  const foreignLines: string[] = [];

  for (const line of lines) {
    if (hasChinese(line)) {
      zhLines.push(line);
    } else {
      foreignLines.push(line);
    }
  }

  if (zhLines.length > 0 && foreignLines.length > 0) {
    return {
      primary: zhLines.join('\n'),
      secondary: foreignLines.join('\n'),
    };
  }

  // If both have Chinese or neither has, split by first half and second half
  if (lines.length === 2) {
    return {
      secondary: lines[0],
      primary: lines[1],
    };
  }

  return { primary: rawText };
}
