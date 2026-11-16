/**
 * Light clean-up of a counterparty name as printed, for parsed statements
 * (the AI path cleans names itself): drop payment-processor prefixes
 * ("CCV*", "Zettle_*", "SumUp *"), "via <app>" suffixes, store numbers and
 * what follows them ("Albert Heijn 1234", "Lidl 123 Enschede"), and trailing
 * ", NL"-style country codes.
 */
export function cleanMerchant(raw: string): string | null {
	let s = raw.trim();
	// Exchange-rate notes on foreign-currency card payments.
	s = s.replace(/\s*(Revolut Rate|ECB rate)\b.*$/i, "");
	// Long reference numbers glued to a name ("BOLT.EUR2608200637").
	s = s.replace(/[.\s][A-Z]{0,4}\d{6,}$/, "");
	// Payment-processor prefix ("CCV*Shop"), unless that is the whole name
	// ("Revolut**1234*" is a top-up to a Revolut card: keep "Revolut").
	const withoutPrefix = s.replace(/^(?:[A-Za-z0-9]{2,8}[_ ]?\*\s*)/, "");
	s = /[A-Za-z]/.test(withoutPrefix) ? withoutPrefix : s.replace(/[*\d]+/g, " ").trim();
	// Masked card references alone ("*0096*") aren't a name.
	if (!/[A-Za-z]/.test(s)) return null;
	s = s.replace(/\s+via\s+.+$/i, "");
	s = s.replace(/,\s*[A-Z]{2,3}$/, "");
	s = s.replace(/^(\S.*?)\s+\d{2,}\b.*$/, "$1");
	s = s.replace(/\s{2,}/g, " ").trim();
	return s || null;
}
