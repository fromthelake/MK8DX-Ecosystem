// The central slot-presence decision (CENTRAL_RECOGNITION section 8.6): the TypeScript port of
// python/mk8dx_icon_matcher/slot_presence.py (the reference) and SlotPresence.java. Whether an icon
// or flag slot holds a picture or only flat card background; the product measures the slot and
// hands the statistic in (photo: grey-value standard deviation; hdmi: mean per-channel spatial
// standard deviation).

export const SLOT_PRESENCE_PROFILES: Record<string, { statistic: string; icon?: number; flag?: number }> = {
  photo: { statistic: 'gray_std', icon: 21.5, flag: 20.0 },
  hdmi: { statistic: 'channel_std', flag: 40.0 },
};

export interface SlotPresence { present: boolean; statistic: string; threshold: number | null; value: number }

export function slotPresent(source: 'photo' | 'hdmi', kind: 'icon' | 'flag', value: number): SlotPresence {
  const profile = SLOT_PRESENCE_PROFILES[source];
  const threshold = profile[kind] ?? null;
  return { present: threshold === null || value >= threshold, statistic: profile.statistic, threshold, value };
}
