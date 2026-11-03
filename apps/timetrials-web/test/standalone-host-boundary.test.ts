import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";


const appRoot = fileURLToPath(new URL("../", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(`${appRoot}${relativePath}`, "utf8");
}

describe("integrated web production host boundary", () => {
  it("contains the target-owned profile, activity, manual, catalog, and page modules", () => {
    expect(readdirSync(`${appRoot}src`).sort()).toEqual([
      "account-time-trial-settings.ts",
      "activity-feed-contract.ts",
      "activity-feed-model.ts",
      "activity-stories.ts",
      "activity-story-summary.ts",
      "administrator-alias-section.ts",
      "administrator-claim-review-section.ts",
      "administrator-client-installation-section.ts",
      "administrator-identity-link-section.ts",
      "administrator-observed-identity-section.ts",
      "administrator-overview-client.ts",
      "administrator-overview-section.ts",
      "administrator-time-trial-section.ts",
      "administrator-tournament-removal-section.ts",
      "app-downloads-view.ts",
      "appearance-client.ts",
      "appearance-runtime.ts",
      "appearance-settings.ts",
      "appearance.ts",
      "asset-manifest.ts",
      "authentication-client.ts",
      "authentication-product-page.ts",
      "avatar-manifest.ts",
      "avatar-settings.ts",
      "benchmark-manifest.ts",
      "career-section.ts",
      "character-picker-names.ts",
      "claim-walk-client.ts",
      "competitive-presentation.ts",
      "country-settings.ts",
      "director-host-request-client.ts",
      "director-host-request-section.ts",
      "ds-activity.ts",
      "ds-build.ts",
      "ds-community.ts",
      "ds-compare.ts",
      "ds-components.ts",
      "ds-cups.ts",
      "ds-gallery.ts",
      "ds-home.ts",
      "ds-mystats.ts",
      "ds-numeric.ts",
      "ds-public-tournament.ts",
      "ds-records.ts",
      "ds-scan.ts",
      "ds-setup-picker.ts",
      "ds-shell.ts",
      "ds-tournaments.ts",
      "ds-track-board.ts",
      "dutch-presentation.generated.ts",
      "dutch-ui-copy.ts",
      "engine-context.ts",
      "home-focus.ts",
      "home-hero.ts",
      "i18n-catalog-index.generated.ts",
      "identity-link-client.ts",
      "installation-settings-client.ts",
      "installation-settings-section.ts",
      "language-settings.ts",
      "loadout-manifest.ts",
      "loadout-variants.ts",
      "main.ts",
      "manual-authenticated-bootstrap.ts",
      "manual-context-document.ts",
      "manual-context-json.ts",
      "manual-publication-client.ts",
      "manual-submission.ts",
      "mastery-thresholds.ts",
      "mastery-view.ts",
      "name-disambiguation.ts",
      "native-email-approval-client.ts",
      "nav-identity-cache.ts",
      "notification-client.ts",
      "notification-section.ts",
      "observed-identity-client.ts",
      "platform-mark.ts",
      "player-activity-client.ts",
      "player-alias-client.ts",
      "player-claim-client.ts",
      "player-claim-section.ts",
      "player-claim-walk.ts",
      "player-engagement-client.ts",
      "player-insights-client.ts",
      "player-interactions-panel.ts",
      "player-profile-preference-settings.ts",
      "player-visibility-settings.ts",
      "podium-mark.ts",
      "post-time-model.ts",
      "post-time-prediction.ts",
      "post-time-session.ts",
      "post-time-task.ts",
      "preloaded-responses.ts",
      "product-catalog.ts",
      "product-language.ts",
      "profile-alias-section.ts",
      "public-player-client.ts",
      "public-player-profile.ts",
      "public-time-trial-client.ts",
      "public-time-trial-view.ts",
      "public-tournament-whatsapp.ts",
      "rank-track-focus.ts",
      "rating-administration-section.ts",
      "rating-graph.ts",
      "rating-view.ts",
      "reaction-bar.ts",
      "reaction-client.ts",
      "reference-ghost-readings.ts",
      "return-intent.ts",
      "rival-settings.ts",
      "route-identity.ts",
      "run-share-card.ts",
      "scan-handoff.ts",
      "scan-service.ts",
      "scan-test-section.ts",
      "schema9-track-catalog.ts",
      "short-links.ts",
      "site-backdrop.ts",
      "social-group-settings.ts",
      "time-trial-lifecycle-client.ts",
      "time-trial-management.ts",
      "time-trial-rules.generated.ts",
      "time-trial-standing-view.ts",
      "tournament-canonical-import-section.ts",
      "tournament-career.ts",
      "tournament-character.ts",
      "tournament-csv.ts",
      "tournament-equipment-review.ts",
      "tournament-export-image.ts",
      "tournament-export-tokens.generated.ts",
      "tournament-group-board.ts",
      "tournament-incoming-client.ts",
      "tournament-incoming-section.ts",
      "tournament-insights.ts",
      "tournament-night-report-view.ts",
      "tournament-operation-client.ts",
      "tournament-operation-view.ts",
      "tournament-operator-access-section.ts",
      "tournament-publication-client.ts",
      "tournament-publication-section.ts",
      "tournament-race-class.ts",
      "tournament-report-chart.ts",
      "tournament-report-classic.ts",
      "tournament-report-client.ts",
      "tournament-report-editor.ts",
      "tournament-report-grants.ts",
      "tournament-report-markup.ts",
      "tournament-report-template.ts",
      "tournament-report-view.ts",
      "tournament-report-wordpress.ts",
      "tournament-report.ts",
      "tournament-roster-picker.ts",
      "tournament-score-matching.ts",
      "tournament-signup-board-section.ts",
      "tournament-signup-client.ts",
      "tournament-signup-section.ts",
      "tournament-standing-client.ts",
      "tournament-standing-link.ts",
      "tournament-standing-view.ts",
      "tournament-start-clock.ts",
      "tournament-statistics-client.ts",
      "tournament-statistics-view.ts",
      "tournament-step-progress.ts",
      "tournament-stories.ts",
      "tournament-tiers.ts",
      "tournament-track-client.ts",
      "tournament-track-section.ts",
      "tournament-viewer-standing.ts",
      "tournaments-view-labels.ts",
      "tournaments-view.ts",
      "track-currency.ts",
      "track-scope.ts",
      "track-thumb.ts",
      "web-push-settings.ts",
      "welcome-onboarding.ts",
      "wordpress-export-format.ts",
      "youtube-link.ts",
    ]);
    const appFiles = readdirSync(appRoot).sort();
    expect(appFiles).toContain("index.html");
    expect(appFiles).not.toContain("public");
    expect(read("index.html")).toContain('<div id="app"></div>');
    expect(read("index.html")).toContain('<script type="module" src="./dist/main.js">');
  });

  it("builds source modules only and has no separate runtime dependency", () => {
    const packageJson = JSON.parse(read("package.json")) as Record<string, unknown>;
    const scripts = packageJson.scripts as Record<string, string>;
    expect(Object.keys(scripts).sort()).toEqual(["build", "test", "typecheck"]);
    expect(packageJson).not.toHaveProperty("dependencies");
    expect(read("tsconfig.build.json")).toContain('"include": ["src/**/*.ts"]');
    expect(read("tsconfig.build.json")).toContain('"exclude": ["test/**/*.ts"]');
  });

  it("mounts passwordless session and device authorization before the product", () => {
    const main = read("src/main.ts");
    const authentication = read("src/authentication-product-page.ts");
    expect(main).toContain("mountAuthenticationProductPage(root)");
    expect(authentication).toContain('pathname === "/device"');
    expect(authentication).toContain("mountPostTimeTask");
    expect(authentication).toContain("mountHome");
    expect(authentication).toContain("mountPlayerClaimSection");
    expect(authentication).toContain("mountPlayerInsightsSection");
    expect(authentication).toContain("mountAdministratorClaimReviewSection");
    expect(authentication).not.toMatch(/password|localStorage|sessionStorage/i);
  });

  it("pins the Post-a-Time seam to caller root, injected clients, and a pure model", () => {
    const task = read("src/post-time-task.ts");
    const model = read("src/post-time-model.ts");
    const prediction = read("src/post-time-prediction.ts");
    expect(task).toContain("host: HTMLElement");
    expect(task).toContain("options: PostTimeTaskOptions");
    expect(task).toContain("bootstrapClient?: WebManualAuthenticatedBootstrapClient");
    expect(task).toContain("publicationClient?: WebManualSameOriginPublicationClient");
    // The model and the prediction are pure: no DOM, no network, no clock of their own. Only the
    // task reaches a browser, and only through the boundaries it was handed.
    for (const source of [model, prediction]) {
      expect(source).not.toMatch(
        /firebase|firestore|fetch\s*\(|XMLHttpRequest|document\./i,
      );
    }
    expect(prediction).not.toMatch(/localStorage|sessionStorage/i);
  });
});
