// One list of audience locations for creators (where their followers are) and brands (who a campaign
// targets). Targeting matches on the exact name, so both sides must pick from the same list.

export interface AudienceLocationOption {
  value: string;
  label: string;
}

export interface AudienceLocationGroup {
  label: string;
  options: AudienceLocationOption[];
}

const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi",
  "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

const COUNTRIES = [
  "Nigeria", "Ghana", "Kenya", "South Africa", "Egypt", "Cameroon", "Côte d'Ivoire", "Senegal", "Tanzania", "Uganda",
  "Rwanda", "Ethiopia", "United Kingdom", "United States", "Canada", "United Arab Emirates", "Germany", "France",
  "India", "Other countries",
];

export const AUDIENCE_LOCATION_GROUPS: AudienceLocationGroup[] = [
  {
    label: "Nigerian states",
    options: [...NIGERIAN_STATES, "Abuja"].sort().map((name) => ({ value: name, label: name === "Abuja" ? "Abuja (FCT)" : name })),
  },
  { label: "Countries", options: COUNTRIES.map((name) => ({ value: name, label: name })) },
];

const KNOWN = new Set(AUDIENCE_LOCATION_GROUPS.flatMap((group) => group.options.map((option) => option.value.toLowerCase())));

export function isKnownAudienceLocation(value: string): boolean {
  return KNOWN.has(value.trim().toLowerCase());
}

// A saved value from before locations were picked from the list, matched back to the list's spelling
// when it only differs by case (e.g. "lagos" → "Lagos"); otherwise kept as it was typed.
export function canonicalAudienceLocation(value: string): string {
  const key = value.trim().toLowerCase();
  for (const group of AUDIENCE_LOCATION_GROUPS) {
    const match = group.options.find((option) => option.value.toLowerCase() === key);
    if (match) return match.value;
  }
  return value.trim();
}
