const GEOCODER = "https://geocoder.queria.io/v1/forward";

export type Place = { label: string; lng: number; lat: number };

type Result = {
  matched_address: string;
  unmatched_address: string[] | null;
  lat: number | null;
  lng: number | null;
  ambiguous: boolean;
};

/**
 * Geocode a Japanese address. Returns only results matched to a single point; an address that
 * matches nothing gives an empty array. Rate limits and other HTTP errors throw.
 */
export const geocode = async (address: string, signal?: AbortSignal): Promise<Place[]> => {
  const url = `${GEOCODER}?address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const body = (await res.json()) as { results: Result[] };
  return body.results.flatMap((r) =>
    !r.ambiguous && !r.unmatched_address?.length && r.lng != null && r.lat != null
      ? [{ label: r.matched_address, lng: r.lng, lat: r.lat }]
      : [],
  );
};
