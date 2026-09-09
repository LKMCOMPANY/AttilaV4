import { describe, expect, it } from "vitest";
import { localeCoherence, timezoneCoherence } from "./geo";

/**
 * The coherence recipe files an attention item on "incoherent" only: a
 * country we have no table for, or a device that did not answer, must stay a
 * shrug — never a false alarm on 445 devices.
 */
describe("persona ↔ device coherence", () => {
  it("accepts the home zone and refuses a foreign one", () => {
    expect(timezoneCoherence("FR", "Europe/Paris")).toBe("coherent");
    expect(timezoneCoherence("fr", "Europe/Paris")).toBe("coherent");
    expect(timezoneCoherence("FR", "Asia/Shanghai")).toBe("incoherent");
    expect(timezoneCoherence("US", "America/Los_Angeles")).toBe("coherent");
    expect(timezoneCoherence("US", "Europe/Paris")).toBe("incoherent");
  });

  it("has no opinion on an unknown country or a missing zone", () => {
    expect(timezoneCoherence("ZZ", "Europe/Paris")).toBe("unknown");
    expect(timezoneCoherence(null, "Europe/Paris")).toBe("unknown");
    expect(timezoneCoherence("FR", null)).toBe("unknown");
  });

  it("matches the device language to the country's languages, whatever the separator", () => {
    expect(localeCoherence("FR", "fr-FR")).toBe("coherent");
    expect(localeCoherence("FR", "fr_FR")).toBe("coherent");
    expect(localeCoherence("FR", "en-GB")).toBe("incoherent");
    expect(localeCoherence("MA", "ar-MA")).toBe("coherent");
    expect(localeCoherence("MA", "fr-FR")).toBe("coherent");
    expect(localeCoherence("BE", "nl_BE")).toBe("coherent");
    expect(localeCoherence("ZZ", "fr-FR")).toBe("unknown");
    expect(localeCoherence("FR", "")).toBe("unknown");
  });
});
