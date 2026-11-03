// Isolated M1 candidate copied from cleanAssets.ts (source Git blob f0ffe8f9b1b88d72317a971de0532c23bd418b2d).
// Only the pooled whole-crop brightness gain inside identifyCrop is removed.
// Search-window normalization remains identical to the existing Web matcher.
// Port van CleanAssetsMatcher: character/kart(bodies)/glider via de gebakken
// clean-assets-pack (refs/masks op boxmaat, familie-maskers, chroma-hoeken,
// char->parts-kleursets, vocab, stats). Besliskern identify_crop +
// identify_crop_search (TM_SQDIFF-positiezoek, 2 iteraties) 1:1 overgenomen.
import type { AssetSource } from './assets';
import { loadBgr, loadGray } from './assets';
import { cv } from './cv';
import type { IdentityEntry } from './types';

const PACK_ROOT = 'clean_assets';
const DEFAULT_OFFSETS: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const CENTER_ONLY: [number, number][] = [[0, 0]];
const INKLING_NCC_VETO_MARGIN = 0.04;

interface Group {
  name: string;
  boxW: number;
  boxH: number;
  ids: string[];
  sat: number[];
  names: Record<string, string>;
  families: Record<string, string>;
  rgb: Float32Array[];
  mask: Float32Array[];
  maskSum: number[];
  rgbMaskSum: number[];
  refBgr8: any[];
  refMask8: any[];
}

interface SizedSet {
  rgbs: any[];
  masks: any[];
  sums: number[];
}

export function familyOf(rid: string): string {
  const parts = rid.split('.');
  if (parts.length >= 2 && parts[0].endsWith('_variant')) {
    return parts[0].replace('_variant', '') + '.' + parts[1];
  }
  return rid;
}

function round4(v: number): number {
  return Math.round(v * 10000.0) / 10000.0;
}

export class CleanAssetsMatcher {
  private readonly groups = new Map<string, Group>();
  private readonly siblingPairOf = new Map<string, string>();
  private readonly famMasks = new Map<string, Float32Array>();
  private readonly famShapeMasks = new Map<string, Float32Array>();
  private readonly sizedCache = new Map<string, SizedSet>();
  private readonly vocabCache = new Map<string, Record<string, string>>();
  pack: any;

  static async load(source: AssetSource): Promise<CleanAssetsMatcher> {
    const m = new CleanAssetsMatcher();
    m.pack = await source.json(`${PACK_ROOT}/pack.json`);
    const boxes = m.pack.box;
    const groupsMeta = m.pack.groups;
    for (const name of Object.keys(groupsMeta)) {
      const meta = groupsMeta[name];
      const box = boxes[name];
      const g: Group = {
        name,
        boxW: box[0],
        boxH: box[1],
        ids: [...meta.ids],
        sat: [...meta.sat],
        names: { ...meta.names },
        families: { ...meta.families },
        rgb: [],
        mask: [],
        maskSum: [],
        rgbMaskSum: [],
        refBgr8: [],
        refMask8: [],
      };
      // refs parallel ophalen (1148 kleine PNG's over http)
      const refs = await Promise.all(g.ids.map((_, i) => Promise.all([
        loadBgr(source, `${PACK_ROOT}/refs/${name}/${i}.png`),
        loadGray(source, `${PACK_ROOT}/masks/${name}/${i}.png`),
      ])));
      for (let i = 0; i < g.ids.length; i++) {
        const [bgr, mask8] = refs[i];
        g.refBgr8.push(bgr);
        g.refMask8.push(mask8);
        g.rgb.push(bgr8ToFloat(bgr));
        g.mask.push(gray8ToBinFloat(mask8));
        let ms = 0.0;
        let rms = 0.0;
        const mk = g.mask[i];
        const rgb = g.rgb[i];
        for (let p = 0; p < mk.length; p++) {
          const mv = mk[p];
          if (mv > 0) {
            ms += mv;
            const pi = p * 3;
            rms += mv * (rgb[pi] + rgb[pi + 1] + rgb[pi + 2]);
          }
        }
        g.maskSum.push(ms);
        g.rgbMaskSum.push(rms);
      }
      m.groups.set(name, g);
    }
    const sp = m.pack.sibling_pair_of ?? {};
    for (const rid of Object.keys(sp)) m.siblingPairOf.set(rid, sp[rid]);
    const fm = m.pack.family_masks;
    for (const key of Object.keys(fm)) {
      const gray = await loadGray(source, `${PACK_ROOT}/fam/${key}.png`);
      m.famMasks.set(key, gray8ToBinFloat(gray));
      gray.delete();
    }
    const shapes = m.pack.sibling_pair_shape ?? {};
    for (const key of Object.keys(shapes)) {
      const gray = await loadGray(source, `${PACK_ROOT}/fam/${key}_shape.png`);
      m.famShapeMasks.set(key, gray8ToBinFloat(gray));
      gray.delete();
    }
    return m;
  }

  displayName(rid: string, group: string): string {
    const g = this.groups.get(group);
    return g ? (g.names[rid] ?? rid) : rid;
  }

  vocabOf(group: string): Record<string, string> {
    const cached = this.vocabCache.get(group);
    if (cached) return cached;
    const out: Record<string, string> = {};
    const table = this.pack.vocab?.[group];
    if (table) {
      for (const key of Object.keys(table)) out[key] = String(table[key] ?? '');
    }
    this.vocabCache.set(group, out);
    return out;
  }

  statsFor(group: string, key: string | null): number[] | null {
    const row = key ? this.pack.stats?.[group]?.[key] : null;
    if (!row || row.length < 4) return null;
    return row.map((v: number) => Number(v) || 0);
  }

  idForName(group: string, name: string): string | null {
    const g = this.groups.get(group);
    if (!g || !name) return null;
    for (const [rid, n] of Object.entries(g.names)) if (n === name) return rid;
    return null;
  }

  variantFor(charId: string | null, group: string, baseId: string): string {
    const groupMap = charId ? this.pack.char_to_parts?.[charId]?.[group] : null;
    const variant = groupMap ? groupMap[baseId] : null;
    return variant && variant.length > 0 ? variant : baseId;
  }

  hasVariants(group: string, baseId: string): boolean {
    const ids = this.groups.get(group)?.ids ?? [];
    return ids.some((rid) => rid !== baseId && familyOf(rid) === baseId);
  }

  assetRefFor(rid: string, group: string): string | null {
    const g = this.groups.get(group);
    if (!g) return null;
    const idx = g.ids.indexOf(rid);
    return idx < 0 ? null : `${PACK_ROOT}/refs/${group}/${idx}.png`;
  }

  partsSubsetForCharacter(charId: string, group: string): string[] | null {
    const groupMap = this.pack.char_to_parts?.[charId]?.[group] ?? null;
    const g = this.groups.get(group);
    if (!g) return null;
    const subset: string[] = [];
    for (const rid of g.ids) {
      if (rid.split('.')[0].endsWith('_variant')) continue;
      const variant = groupMap ? groupMap[rid] : null;
      subset.push(variant && variant.length > 0 ? variant : rid);
    }
    return subset.length === 0 ? null : subset;
  }

  charsForPartVariant(group: string, variantId: string): string[] {
    const out: string[] = [];
    const mapping = this.pack.char_to_parts;
    if (!mapping || !variantId) return out;
    for (const charId of Object.keys(mapping)) {
      const groupMap = mapping[charId]?.[group];
      if (!groupMap) continue;
      for (const base of Object.keys(groupMap)) {
        if (groupMap[base] === variantId) {
          out.push(charId);
          break;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // identify_crop
  // ------------------------------------------------------------------
  identifyCrop(cropBgr: any, groupName: string, subsetIds: Set<string> | null, offsets: [number, number][] | null, topk: number): IdentityEntry {
    const c = cv();
    const g = this.groups.get(groupName);
    if (!g || cropBgr.empty()) return { id: null, score: 0.0, margin: 0.0 };
    if (!offsets) offsets = DEFAULT_OFFSETS;
    const q8 = new c.Mat();
    c.resize(cropBgr, q8, new c.Size(g.boxW, g.boxH), 0, 0, c.INTER_AREA);
    const qRaw = bgr8ToFloat(q8);
    let idx: number[];
    if (subsetIds && subsetIds.size > 0) {
      const keep: number[] = [];
      for (let i = 0; i < g.ids.length; i++) if (subsetIds.has(g.ids[i])) keep.push(i);
      idx = keep.length === 0 ? allIndices(g.ids.length) : keep;
    } else {
      idx = allIndices(g.ids.length);
    }
    const q = new Float32Array(qRaw);
    // M1 ablation: preserve the crop's camera/capture colours at scoring time.
    const scores = new Float64Array(idx.length);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      let best = -1.0;
      for (const off of offsets) {
        const s = dRgbScore(q, g.boxW, g.boxH, off[0], off[1], g.rgb[i], g.mask[i], g.maskSum[i]);
        if (s > best) best = s;
      }
      scores[k] = best;
    }
    let order: number[] = allIndices(idx.length);
    // Arrays.sort(Integer[], comparator) is stabiel (TimSort) — JS sort ook
    order.sort((a, b) => (scores[b] > scores[a] ? 1 : scores[b] < scores[a] ? -1 : 0));
    if (g.sat[idx[order[0]]] <= 0.06) {
      const satHue = qSatHue(q, g.boxW, g.boxH);
      const m0 = g.mask[idx[order[0]]];
      let wSum = 0.0;
      let satSum = 0.0;
      const n = g.boxW * g.boxH;
      for (let p = 0; p < n; p++) {
        const hue = satHue[p * 2 + 1];
        const nonYellow = hue < 18 || hue > 36 ? 1 : 0;
        const w = m0[p] * nonYellow;
        wSum += w;
        satSum += satHue[p * 2] * w;
      }
      const cropSat = satSum / (wSum + 1e-6);
      if (cropSat >= 0.12) {
        const chrom: number[] = [];
        const achrom: number[] = [];
        for (const o of order) {
          if (g.sat[idx[o]] > 0.06) chrom.push(o);
          else achrom.push(o);
        }
        if (chrom.length > 0 && scores[order[0]] - scores[chrom[0]] <= 0.02) {
          order = [...chrom, ...achrom];
        }
      }
    }
    if (order.length > 1 && scores[order[0]] - scores[order[1]] < 0.04) {
      const queryFg = foregroundMask(q8);
      if (queryFg) {
        let bestCombined = -2.0;
        let bestPos = 0;
        for (let k = 0; k < Math.min(5, order.length); k++) {
          if (scores[order[0]] - scores[order[k]] > 0.05) break;
          const iou = maskIou(queryFg, g.mask[idx[order[k]]]);
          const combined = scores[order[k]] + 0.10 * iou;
          if (combined > bestCombined) {
            bestCombined = combined;
            bestPos = k;
          }
        }
        if (bestPos !== 0) {
          const winner = order[bestPos];
          for (let k = bestPos; k > 0; k--) order[k] = order[k - 1];
          order[0] = winner;
        }
      }
    }
    const top3: [string, number][] = [];
    for (let k = 0; k < Math.min(3, order.length); k++) top3.push([g.ids[idx[order[k]]], round4(scores[order[k]])]);
    let topkList: [string, number][] | null = null;
    if (topk > 0) {
      topkList = [];
      for (let k = 0; k < Math.min(topk, order.length); k++) topkList.push([g.ids[idx[order[k]]], round4(scores[order[k]])]);
    }
    let rid = g.ids[idx[order[0]]];
    const rawRid = rid;
    const score = scores[order[0]];
    const margin = order.length > 1 ? score - scores[order[1]] : 1.0;
    const famWin = familyOf(rid);
    let marginExt = 1.0;
    for (let k = 1; k < order.length; k++) {
      if (familyOf(g.ids[idx[order[k]]]) !== famWin) {
        marginExt = score - scores[order[k]];
        break;
      }
    }
    let nccFamilyVeto: number | null = null;
    let nccFamilyCheck: { winner: string; score: number; margin: number } | null = null;
    if (subsetIds === null) {
      const famKey = this.famKeyFor(groupName, famWin);
      if (famKey) {
        const fmMeta = this.pack.family_masks[famKey];
        const dsum: number = fmMeta.dsum;
        const dmask = this.famMasks.get(famKey);
        if (dmask && dsum >= 8.0) {
          const members: number[] = fmMeta.member_indices;
          let pick: number | null = null;
          const cropAng = chromaAngle(q8, dmask);
          if (!Number.isNaN(cropAng[0]) && cropAng[1] >= 20.0) {
            let bestDiff = Number.MAX_VALUE;
            let secondDiff = Number.MAX_VALUE;
            let bestMember = -1;
            const chroma = this.pack.family_chroma[famKey];
            for (const refIdx of members) {
              const am = chroma[String(refIdx)];
              if (!am || am[0] === null || am[1] < 20.0) continue;
              const diff = Math.abs(((cropAng[0] - am[0]) + 540.0) % 360.0 - 180.0);
              if (diff < bestDiff) {
                secondDiff = bestDiff;
                bestDiff = diff;
                bestMember = refIdx;
              } else if (diff < secondDiff) {
                secondDiff = diff;
              }
            }
            if (bestMember >= 0 && (secondDiff === Number.MAX_VALUE || secondDiff - bestDiff >= 8.0)) pick = bestMember;
          }
          if (pick !== null) {
            rid = g.ids[pick];
          } else {
            const achromMagMax = groupName === 'characters' ? 18.5 : 12.0;
            let kandidaten = [...members];
            if (cropAng[1] < achromMagMax) {
              const chroma = this.pack.family_chroma[famKey];
              const achrom: number[] = [];
              for (const i of kandidaten) {
                const am = chroma[String(i)];
                const mag = am ? am[1] : 99.0;
                if (mag < 20.0) achrom.push(i);
              }
              if (achrom.length > 0) kandidaten = achrom;
            }
            let fBest = -2.0;
            let fBestIdx = kandidaten[0];
            for (const i of kandidaten) {
              const s = dRgbScore(q, g.boxW, g.boxH, 0, 0, g.rgb[i], dmask, dsum);
              if (s > fBest) {
                fBest = s;
                fBestIdx = i;
              }
            }
            rid = g.ids[fBestIdx];
          }
        }
      }
      const pairKey = this.siblingPairOf.get(rid);
      if (pairKey && this.famMasks.has(pairKey)) {
        const pmMeta = this.pack.family_masks[pairKey];
        const pmask = this.famMasks.get(pairKey)!;
        const pAng = chromaAngle(q8, pmask);
        const shape = this.pack.sibling_pair_shape ? this.pack.sibling_pair_shape[pairKey] : null;
        let meisjeachtig = false;
        let zekerGeenKnot = false;
        if (shape && this.famShapeMasks.has(pairKey)) {
          const bAng = chromaAngle(q8, this.famShapeMasks.get(pairKey)!);
          const femaleAngle = shape.female_angle === null || shape.female_angle === undefined ? Number.NaN : shape.female_angle;
          meisjeachtig = !Number.isNaN(bAng[0]) && bAng[1] >= 15.0 && !Number.isNaN(femaleAngle)
            && Math.abs(((bAng[0] - femaleAngle) + 540.0) % 360.0 - 180.0) <= 30.0;
          zekerGeenKnot = bAng[1] < 10.0;
        }
        if (!Number.isNaN(pAng[0]) && pAng[1] >= 20.0) {
          const members: number[] = pmMeta.member_indices;
          const chroma = this.pack.family_chroma[pairKey];
          const pc: [number, number][] = [];
          for (const refIdx of members) {
            const am = chroma[String(refIdx)];
            if (!am || am[0] === null || am[1] < 20.0) continue;
            pc.push([Math.abs(((pAng[0] - am[0]) + 540.0) % 360.0 - 180.0), refIdx]);
          }
          pc.sort((a, b) => a[0] - b[0]);
          if (pc.length >= 2 && pc[1][0] - pc[0][0] >= 8.0) {
            const doel = g.ids[pc[0][1]];
            let akkoord = true;
            if (shape) {
              const femaleRid = shape.female_rid;
              akkoord = doel === femaleRid ? meisjeachtig : !meisjeachtig;
            }
            if (akkoord) rid = doel;
          } else if (shape && rid === shape.female_rid && zekerGeenKnot && pc.length > 0) {
            for (const entry of pc) {
              const candidate = g.ids[entry[1]];
              if (candidate !== shape.female_rid) {
                rid = candidate;
                break;
              }
            }
          }
        }
      }
      // A TV/camera hue shift can make Inkling Boy's colour pass override a
      // clear visual winner. Restore it only when masked NCC independently agrees.
      if (groupName === 'characters' && famWin === 'character.inkling_boy'
          && rid !== rawRid && familyOf(rid) === famWin
          && score >= 0.80 && margin >= 0.02) {
        const famKey = this.famKeyFor(groupName, famWin);
        const members: number[] = famKey ? this.pack.family_masks[famKey].member_indices : [];
        let nccBest = -2.0;
        let nccSecond = -2.0;
        let nccWinner = -1;
        for (const i of members) {
          let memberBest = -2.0;
          for (const [dx, dy] of offsets) {
            memberBest = Math.max(memberBest, dNccScore(q, g.boxW, g.boxH, dx, dy,
              g.rgb[i], g.mask[i], g.maskSum[i]));
          }
          if (memberBest > nccBest) {
            nccSecond = nccBest;
            nccBest = memberBest;
            nccWinner = i;
          } else if (memberBest > nccSecond) {
            nccSecond = memberBest;
          }
        }
        if (nccWinner >= 0) {
          nccFamilyCheck = { winner: g.ids[nccWinner], score: round4(nccBest),
            margin: round4(nccBest - nccSecond) };
        }
        if (nccWinner >= 0 && g.ids[nccWinner] === rawRid && nccBest >= 0.35
            && nccBest - nccSecond >= INKLING_NCC_VETO_MARGIN) {
          rid = rawRid;
          nccFamilyVeto = round4(nccBest - nccSecond);
        }
      }
    }
    q8.delete();
    const out: IdentityEntry = {
      id: rid,
      name: g.names[rid] ?? rid,
      score: round4(score),
      margin: round4(margin),
      margin_ext: round4(marginExt),
      top3,
      family: famWin,
    };
    if (topkList) out.topk = topkList;
    if (nccFamilyCheck !== null) out.ncc_family_check = nccFamilyCheck;
    if (nccFamilyVeto !== null) out.ncc_family_veto_margin = nccFamilyVeto;
    return out;
  }

  // ------------------------------------------------------------------
  // identify_crop_search — ±search px TM_SQDIFF, 2 iteraties
  // ------------------------------------------------------------------
  identifyCropSearch(imageBgr: any, bx: number, by: number, bw: number, bh: number, groupName: string, subsetIds: Set<string> | null, search: number, topk: number): IdentityEntry {
    const c = cv();
    const g = this.groups.get(groupName);
    const tw = Math.round(bw);
    const th = Math.round(bh);
    const imgW = imageBgr.cols;
    const imgH = imageBgr.rows;
    const x1 = Math.round(bx);
    const y1 = Math.round(by);
    const nominal = clipRect(x1, y1, tw, th, imgW, imgH);
    if (!g || nominal.width <= 0 || nominal.height <= 0) {
      return { id: null, score: 0.0, margin: 0.0, dx: 0, dy: 0 };
    }
    const crop0 = imageBgr.roi(new c.Rect(nominal.x, nominal.y, nominal.width, nominal.height));
    let best = this.identifyCrop(crop0, groupName, subsetIds, CENTER_ONLY, topk);
    crop0.delete();
    best.dx = 0;
    best.dy = 0;
    const wx1 = Math.max(0, x1 - search);
    const wy1 = Math.max(0, y1 - search);
    const wx2 = Math.min(imgW, x1 + tw + search);
    const wy2 = Math.min(imgH, y1 + th + search);
    if (tw < 8 || th < 8 || wy2 - wy1 < th || wx2 - wx1 < tw) return best;
    const sized = this.sized(groupName, tw, th);
    const winRoi = imageBgr.roi(new c.Rect(wx1, wy1, wx2 - wx1, wy2 - wy1));
    const winF = new c.Mat();
    winRoi.convertTo(winF, c.CV_32FC3, 1.0 / 255.0);
    winRoi.delete();
    let refNum = 0.0;
    let refDen = 0.0;
    for (let i = 0; i < g.ids.length; i++) {
      refNum += g.rgbMaskSum[i] / Math.max(g.maskSum[i], 1e-6) * sized.sums[i] / 3.0;
      refDen += sized.sums[i] / 3.0;
    }
    const refMean = refNum / Math.max(refDen, 1e-6) / 3.0;
    const winMean = c.mean(winF);
    const m = (winMean[0] + winMean[1] + winMean[2]) / 3.0;
    if (m > 1e-4) {
      const gain = Math.max(0.6, Math.min(1.8, refMean / m));
      const gainMat = new c.Mat(winF.rows, winF.cols, c.CV_32FC3, new c.Scalar(gain, gain, gain));
      c.multiply(winF, gainMat, winF);
      gainMat.delete();
      const oneMat = new c.Mat(winF.rows, winF.cols, c.CV_32FC3, new c.Scalar(1.0, 1.0, 1.0));
      c.min(winF, oneMat, winF);
      oneMat.delete();
    }
    let curDx = 0;
    let curDy = 0;
    for (let round = 0; round < 2; round++) {
      let posBestScore = -Number.MAX_VALUE;
      let posBestX = -1;
      let posBestY = -1;
      const result = new c.Mat();
      for (let refIdx = 0; refIdx < g.ids.length; refIdx++) {
        if (sized.sums[refIdx] < 24.0) continue;
        if (subsetIds && !subsetIds.has(g.ids[refIdx])) continue;
        c.matchTemplate(winF, sized.rgbs[refIdx], result, c.TM_SQDIFF, sized.masks[refIdx]);
        patchNaNs(result, 1e12);
        const mm = c.minMaxLoc(result);
        const sc = 1.0 - mm.minVal / sized.sums[refIdx];
        if (sc > posBestScore) {
          posBestScore = sc;
          posBestX = mm.minLoc.x;
          posBestY = mm.minLoc.y;
        }
      }
      result.delete();
      if (posBestX < 0) break;
      const dx = wx1 + posBestX - x1;
      const dy = wy1 + posBestY - y1;
      if (dx === curDx && dy === curDy) break;
      const r = clipRect(x1 + dx, y1 + dy, tw, th, imgW, imgH);
      const shifted = imageBgr.roi(new c.Rect(r.x, r.y, r.width, r.height));
      const out = this.identifyCrop(shifted, groupName, subsetIds, CENTER_ONLY, topk);
      shifted.delete();
      if ((out.score ?? 0.0) < (best.score ?? 0.0)) break;
      out.dx = dx;
      out.dy = dy;
      best = out;
      curDx = dx;
      curDy = dy;
    }
    winF.delete();
    return best;
  }

  private famKeyFor(group: string, family: string): string | null {
    const fm = this.pack.family_masks;
    for (const key of Object.keys(fm)) {
      const meta = fm[key];
      if (meta.group === group && meta.family === family) return key;
    }
    return null;
  }

  private sized(group: string, tw: number, th: number): SizedSet {
    const key = `${group}|${tw}x${th}`;
    const cached = this.sizedCache.get(key);
    if (cached) return cached;
    const c = cv();
    const g = this.groups.get(group)!;
    const rgbs: any[] = [];
    const masks: any[] = [];
    const sums: number[] = [];
    for (let i = 0; i < g.ids.length; i++) {
      const sized8 = new c.Mat();
      c.resize(g.refBgr8[i], sized8, new c.Size(tw, th), 0, 0, c.INTER_AREA);
      const sizedF = new c.Mat();
      sized8.convertTo(sizedF, c.CV_32FC3, 1.0 / 255.0);
      sized8.delete();
      rgbs.push(sizedF);
      const mask8 = new c.Mat();
      c.resize(g.refMask8[i], mask8, new c.Size(tw, th), 0, 0, c.INTER_AREA);
      const maskBin = new c.Mat();
      c.threshold(mask8, maskBin, 127.5, 1.0, c.THRESH_BINARY);
      mask8.delete();
      const maskF1 = new c.Mat();
      maskBin.convertTo(maskF1, c.CV_32F);
      maskBin.delete();
      const three = new c.MatVector();
      three.push_back(maskF1);
      three.push_back(maskF1);
      three.push_back(maskF1);
      const mask3 = new c.Mat();
      c.merge(three, mask3);
      three.delete();
      maskF1.delete();
      masks.push(mask3);
      let s = 0.0;
      const d = mask3.data32F;
      for (let p = 0; p < d.length; p++) s += d[p];
      sums.push(s);
    }
    const set = { rgbs, masks, sums };
    this.sizedCache.set(key, set);
    return set;
  }
}

function patchNaNs(mat: any, value: number): void {
  const d = mat.data32F as Float32Array;
  for (let i = 0; i < d.length; i++) if (Number.isNaN(d[i])) d[i] = value;
}

function clipRect(x: number, y: number, w: number, h: number, imgW: number, imgH: number): { x: number; y: number; width: number; height: number } {
  const cx = Math.max(0, Math.min(imgW - 1, x));
  const cy = Math.max(0, Math.min(imgH - 1, y));
  const cw = Math.min(w, imgW - cx);
  const ch = Math.min(h, imgH - cy);
  return { x: cx, y: cy, width: Math.max(0, cw), height: Math.max(0, ch) };
}

function allIndices(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

/** score = 1 - Σ(mask·|dBGR|)/(masksum·3); query geshift met randreplicatie. */
function dRgbScore(q: Float32Array, w: number, h: number, dx: number, dy: number, ref: Float32Array, mask: Float32Array, maskSum: number): number {
  let d = 0.0;
  for (let y = 0; y < h; y++) {
    let sy = y - dy;
    sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
    for (let x = 0; x < w; x++) {
      const mv = mask[y * w + x];
      if (mv === 0) continue;
      let sx = x - dx;
      sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
      const qi = (sy * w + sx) * 3;
      const ri = (y * w + x) * 3;
      d += mv * (Math.abs(ref[ri] - q[qi]) + Math.abs(ref[ri + 1] - q[qi + 1]) + Math.abs(ref[ri + 2] - q[qi + 2]));
    }
  }
  return 1.0 - d / (maskSum * 3.0 + 1e-6);
}

/** Masked normalized correlation, used only to review a disputed family colour. */
function dNccScore(q: Float32Array, w: number, h: number, dx: number, dy: number, ref: Float32Array, mask: Float32Array, maskSum: number): number {
  const count = maskSum * 3.0 + 1e-6;
  let refSum = 0.0;
  let querySum = 0.0;
  for (let y = 0; y < h; y++) {
    const sy = Math.max(0, Math.min(h - 1, y - dy));
    for (let x = 0; x < w; x++) {
      const mv = mask[y * w + x];
      if (mv === 0) continue;
      const sx = Math.max(0, Math.min(w - 1, x - dx));
      const ri = (y * w + x) * 3;
      const qi = (sy * w + sx) * 3;
      refSum += mv * (ref[ri] + ref[ri + 1] + ref[ri + 2]);
      querySum += mv * (q[qi] + q[qi + 1] + q[qi + 2]);
    }
  }
  const refMean = refSum / count;
  const queryMean = querySum / count;
  let numerator = 0.0;
  let refSquares = 0.0;
  let querySquares = 0.0;
  for (let y = 0; y < h; y++) {
    const sy = Math.max(0, Math.min(h - 1, y - dy));
    for (let x = 0; x < w; x++) {
      const mv = mask[y * w + x];
      if (mv === 0) continue;
      const sx = Math.max(0, Math.min(w - 1, x - dx));
      const ri = (y * w + x) * 3;
      const qi = (sy * w + sx) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const a = ref[ri + channel] - refMean;
        const b = q[qi + channel] - queryMean;
        numerator += mv * a * b;
        refSquares += mv * a * a;
        querySquares += mv * b * b;
      }
    }
  }
  const denominator = Math.sqrt(refSquares * querySquares);
  return denominator > 1e-6 ? numerator / denominator : 0.0;
}

function qSatHue(qBgr: Float32Array, w: number, h: number): Float32Array {
  const c = cv();
  const data = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h * 3; p++) data[p] = Math.max(0, Math.min(255, Math.round(qBgr[p] * 255)));
  const bgr8 = c.matFromArray(h, w, c.CV_8UC3, data);
  const hsv = new c.Mat();
  c.cvtColor(bgr8, hsv, c.COLOR_BGR2HSV);
  const hsvData = hsv.data as Uint8Array;
  const out = new Float32Array(w * h * 2);
  for (let p = 0; p < w * h; p++) {
    out[p * 2] = Math.fround(hsvData[p * 3 + 1] / 255);
    out[p * 2 + 1] = hsvData[p * 3];
  }
  bgr8.delete();
  hsv.delete();
  return out;
}

function foregroundMask(q8: any): Float32Array | null {
  const w = q8.cols;
  const h = q8.rows;
  const data = q8.data as Uint8Array;
  let bgB = 0.0;
  let bgG = 0.0;
  let bgR = 0.0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y >= 2 && y < h - 2 && x >= 2 && x < w - 2) continue;
      const p = (y * w + x) * 3;
      bgB += data[p];
      bgG += data[p + 1];
      bgR += data[p + 2];
      n++;
    }
  }
  if (n === 0) return null;
  bgB /= n;
  bgG /= n;
  bgR /= n;
  const fg = new Float32Array(w * h);
  let fgCount = 0;
  for (let p = 0; p < w * h; p++) {
    const d = Math.abs(data[p * 3] - bgB) + Math.abs(data[p * 3 + 1] - bgG) + Math.abs(data[p * 3 + 2] - bgR);
    if (d > 60.0) {
      fg[p] = 1;
      fgCount++;
    }
  }
  return fgCount < Math.trunc((w * h) / 20) || fgCount > Math.trunc((w * h * 9) / 10) ? null : fg;
}

function maskIou(a: Float32Array, b: Float32Array): number {
  let inter = 0;
  let union = 0;
  for (let p = 0; p < a.length; p++) {
    const pa = a[p] > 0;
    const pb = b[p] > 0.5;
    if (pa && pb) inter++;
    if (pa || pb) union++;
  }
  return union === 0 ? 0.0 : inter / union;
}

/** Chroma-gewogen Lab-tinthoek op gemaskeerde pixels: [hoek_graden|NaN, magnitude]. */
function chromaAngle(bgr8: any, mask: Float32Array): [number, number] {
  const c = cv();
  const lab = new c.Mat();
  c.cvtColor(bgr8, lab, c.COLOR_BGR2Lab);
  const n = lab.rows * lab.cols;
  const data = lab.data as Uint8Array;
  let sw = 0.0;
  let awSum = 0.0;
  let bwSum = 0.0;
  for (let p = 0; p < n; p++) {
    const a = data[p * 3 + 1] - 128.0;
    const b = data[p * 3 + 2] - 128.0;
    const w = mask[p] * Math.hypot(a, b);
    sw += w;
    awSum += a * w;
    bwSum += b * w;
  }
  lab.delete();
  if (sw < 1e-3) return [Number.NaN, 0.0];
  const aw = awSum / sw;
  const bw = bwSum / sw;
  return [(Math.atan2(bw, aw) * 180.0) / Math.PI, Math.hypot(aw, bw)];
}

export function bgr8ToFloat(bgr8: any): Float32Array {
  const d = bgr8.data as Uint8Array;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = Math.fround(d[i] / 255.0);
  return out;
}

export function gray8ToBinFloat(gray8: any): Float32Array {
  const d = gray8.data as Uint8Array;
  const out = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i] > 127 ? 1 : 0;
  return out;
}
