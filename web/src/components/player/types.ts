export type AspectRatioMode = 'contain' | 'cover' | 'fill' | '16:9' | '4:3' | '21:9';

export interface EmbeddedTrack {
  index: number;
  label: string;
  language: string;
  kind: string;
}

export interface OnlineSubItem {
  id: string;
  name: string;
  lang: string;
  source: 'drive' | 'custom' | 'shooter';
  content?: string;
  url?: string;
}
