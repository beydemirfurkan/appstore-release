// A complete app project on disk — config, screenshots, paywall image — for the
// end-to-end test and the demo recordings. The PNGs are header-only: everything
// this tool reads from a screenshot is in the first 33 bytes.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A PNG signature and IHDR for an opaque truecolour image, plus a unique tail. */
export function headerOnlyPng(width, height, tag) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt8(8, 16); // bit depth
  ihdr.writeUInt8(2, 17); // colour type: truecolour, no alpha
  return Buffer.concat([sig, ihdr, Buffer.from(`tail-${tag}`)]);
}

/**
 * The "Wellness" app's project: an iPhone 6.9" set and an iPhone Duo set, a
 * subscription, and a config that says App Privacy is published.
 *
 * @param {string} root  an empty directory
 */
export function writeWellnessProject(root) {
  const shots = { "iphone-6.9": [1320, 2868], "duo-outer": [1398, 2034] };
  for (const [dir, [w, h]] of Object.entries(shots)) {
    mkdirSync(join(root, "shots", dir), { recursive: true });
    for (const name of ["01-today", "02-insights", "03-streaks"]) {
      writeFileSync(join(root, "shots", dir, `${name}-${w}x${h}.png`), headerOnlyPng(w, h, `${dir}-${name}`));
    }
  }
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "assets", "paywall-1320x2868.png"), headerOnlyPng(1320, 2868, "paywall"));

  const config = {
    $schema: "https://raw.githubusercontent.com/beydemirfurkan/appstore-release/main/schemas/config.schema.json",
    locale: "en-US",
    bundleId: "com.example.wellness",
    metadata: {
      name: "Wellness",
      subtitle: "Small habits, every day",
      description: "Track the habits that keep you well. Gentle reminders, honest insights, no streak shaming.",
      keywords: "health,routine,tracker,mood,sleep,mindfulness,journal",
      supportUrl: "https://example.com/support",
      marketingUrl: "https://example.com",
      privacyPolicyUrl: "https://example.com/privacy",
      copyright: "2026 Example Inc.",
    },
    price: "free",
    category: { primary: "HEALTH_AND_FITNESS" },
    contentRights: "DOES_NOT_USE_THIRD_PARTY_CONTENT",
    ageRating: { healthOrWellnessTopics: true },
    review: {
      contactFirstName: "Ada",
      contactLastName: "Lovelace",
      contactPhone: "+1 555 0100",
      contactEmail: "review@example.com",
      demoAccountRequired: false,
      notes: "No sign-in needed. Subscriptions use the sandbox.",
      privacyPublished: true,
    },
    release: { type: "AFTER_APPROVAL" },
    screenshots: {
      sets: [
        { displayType: "APP_IPHONE_67", dir: "./shots/iphone-6.9" },
        { placementGroup: "IPHONE_DUO_OUTER_PROFILE", dir: "./shots/duo-outer" },
      ],
    },
    subscription: {
      productId: "com.example.wellness.monthly",
      groupDisplayName: "Wellness Premium",
      localeName: "Premium Monthly",
      localeDescription: "Every insight, every month.",
      priceTerritory: "USA",
      priceAmount: 4.99,
      reviewScreenshot: "./assets/paywall-1320x2868.png",
    },
  };
  writeFileSync(join(root, "appstore.config.json"), JSON.stringify(config, null, 2) + "\n");
  return config;
}
