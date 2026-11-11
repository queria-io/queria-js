const GEOCODER = "https://geocoder.queria.io/v1/forward";

export type Place = { label: string; lng: number; lat: number };

type Result = {
  matched_address: string;
  unmatched_address: string[] | null;
  lat: number | null;
  lng: number | null;
  ambiguous: boolean;
};

/** Geocode a Japanese address. Returns only results matched to a single point. */
export const geocode = async (address: string, signal?: AbortSignal): Promise<Place[]> => {
  const res = await fetch(`${GEOCODER}?address=${encodeURIComponent(address)}`, { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { results: Result[] };
  return body.results.flatMap((r) =>
    !r.ambiguous && !r.unmatched_address?.length && r.lng != null && r.lat != null
      ? [{ label: r.matched_address, lng: r.lng, lat: r.lat }]
      : [],
  );
};
