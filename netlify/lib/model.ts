export const DEFAULT_AREAS = ['IQC Lab Floor', 'IQC Inspection Area', 'Measuring Area', 'IQC Table', 'Material Shelf', 'Trolley Area', 'Utility Area', 'Waste Area'];
export const GROUPS = ['before', 'after', 'additional'] as const;
export type ImageGroup = typeof GROUPS[number];
export type Photo = { id: string; fullKey: string; thumbKey: string; width: number; height: number; bytes: number; thumbBytes: number };
export type RecordData = { id: string; date: string; area: string; activityType: string; startTime: string; endTime: string; note: string; status: 'cleaned'; published: boolean; beforeImages: Photo[]; afterImages: Photo[]; additionalImages: Photo[]; createdAt: string; updatedAt: string; deleting?: boolean; pendingImages?: (Photo & {group: ImageGroup; batch: string})[]; cleanupKeys?: string[] };
export function validDate(value: string) {
  const parsed = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '2000-01-01' && value <= '2199-12-31' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function validMonth(value: string) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= '2000-01' && value <= '2199-12'; }
export function recordKey(date: string, id: string) { return `records/${date.replaceAll('-', '/')}/${id}.json`; }
export function images(record: RecordData) { return GROUPS.flatMap(g => record[`${g}Images`]); }
export function summary(records: RecordData[], month: string) {
  const rows = records.filter(r => r.published && !r.deleting && r.date.startsWith(month));
  const days = new Set(rows.map(r => r.date)).size;
  const [year, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const areaCounts: Record<string, number> = {}, activityCounts: Record<string, number> = {};
  for (const r of rows) { areaCounts[r.area] = (areaCounts[r.area] || 0) + 1; activityCounts[r.activityType] = (activityCounts[r.activityType] || 0) + 1; }
  return { month, cleaningDays: days, totalActivities: rows.length, cleaningRate: Math.round(days / daysInMonth * 1000) / 10, daysInMonth, areasCleaned: Object.keys(areaCounts).length, photosUploaded: rows.reduce((s, r) => s + images(r).length, 0), areaCounts, activityCounts };
}
export function validateFields(body: any, areas: string[]) {
  if (!validDate(body.date || '')) throw new Error('Choose a valid date.');
  if (!areas.includes(body.area)) throw new Error('Choose an active area.');
  if (typeof body.activityType !== 'string' || !body.activityType.trim() || body.activityType.length > 100) throw new Error('Activity must contain 1–100 characters.');
  if ((body.startTime || body.endTime) && (![body.startTime, body.endTime].every(t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || body.endTime < body.startTime)) throw new Error('Finish time must be on or after start time.');
  if (typeof body.note !== 'string' || body.note.length > 3000) throw new Error('Note must be under 3,000 characters.');
  return { date: body.date, area: body.area, activityType: body.activityType.trim(), startTime: body.startTime || '', endTime: body.endTime || '', note: body.note.trim(), status: 'cleaned' as const };
}
