export type TrackCurrency = Readonly<{
  className: string;
  iconPath: string;
  label: string;
}>;

/** The pickup identity shown by this track instead of the stock coin. */
export function trackCurrency(trackId: string): TrackCurrency {
  if (trackId === "track.hyrule_circuit") {
    return {
      className: "track-board--currency-rupee",
      iconPath: "images/items/icons/002_rupee.png",
      label: "Rupees per lap",
    };
  }
  if (trackId === "track.yoshis_island") {
    return {
      className: "track-board--currency-shine",
      iconPath: "images/items/icons/001_shine.png",
      label: "Yoshi coins per lap",
    };
  }
  if (trackId === "track.animal_crossing") {
    return {
      className: "track-board--currency-bell",
      iconPath: "images/items/icons/003_bell.png",
      label: "Bells per lap",
    };
  }
  return {
    className: "track-board--currency-coin",
    iconPath: "images/items/icons/000_coin.png",
    label: "Coins per lap",
  };
}
