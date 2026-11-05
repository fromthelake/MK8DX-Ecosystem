import type { LocalApiRuntimeRoutePolicies } from "./local-runtime.js";
import {
  createHostedApiRuntime,
  type EmbeddedAuthenticationRuntimePolicy,
  type HostedApiCoreRuntimeConfig,
  type LocalApiRuntime,
} from "./local-runtime.js";
import {
  createSmtpMagicLinkDelivery,
  type SmtpMagicLinkConfig,
} from "../authentication/smtp-magic-link-delivery.js";
import type {
  EmbeddedAuthConfig,
  PasswordlessEmailDelivery,
} from
  "../authentication/embedded-passwordless-auth.js";
import type { WebCsrfKeyMaterial } from "../security/web-csrf-service.js";
import type { WebPushConfiguration } from "../notifications/web-push-delivery.js";

export type PasswordlessHostedRuntimeConfig = Readonly<{
  core: HostedApiCoreRuntimeConfig;
  authentication: EmbeddedAuthConfig;
  smtp?: SmtpMagicLinkConfig;
  /** Isolated A2 mode: no e-mail delivery, Web Push or external imports. */
  offlineLan?: boolean;
  webManual: Readonly<{
    producerVersion: string;
    csrfKeys: WebCsrfKeyMaterial;
  }>;
  webPush?: WebPushConfiguration;
  timeTrialSubmissionAuthorizer?: LocalApiRuntimeRoutePolicies["timeTrialSubmissionAuthorizer"];
  tournamentSubmissionAuthorizer?: LocalApiRuntimeRoutePolicies["tournamentSubmissionAuthorizer"];
  operationalLog?: LocalApiRuntimeRoutePolicies["operationalLog"];
  staticWeb?: LocalApiRuntimeRoutePolicies["staticWeb"];
  publicBundle?: LocalApiRuntimeRoutePolicies["publicBundle"];
  gameAssets?: LocalApiRuntimeRoutePolicies["gameAssets"];
  appDownloads?: LocalApiRuntimeRoutePolicies["appDownloads"];
}>;

export type PasswordlessHostedRuntime = LocalApiRuntime;

export interface HostedMagicLinkDelivery extends PasswordlessEmailDelivery {
  verify(): Promise<void>;
  close(): void;
}

export type HostedMagicLinkDeliveryFactory = (
  config: SmtpMagicLinkConfig,
) => HostedMagicLinkDelivery;

export async function createPasswordlessHostedRuntime(
  config: PasswordlessHostedRuntimeConfig,
  createDelivery: HostedMagicLinkDeliveryFactory = createSmtpMagicLinkDelivery,
): Promise<PasswordlessHostedRuntime> {
  if (config.offlineLan === true && (config.smtp !== undefined || config.webPush !== undefined)) {
    throw new Error("offline LAN cannot configure SMTP or Web Push");
  }
  if (config.offlineLan !== true && config.smtp === undefined) {
    throw new Error("hosted SMTP configuration is required");
  }
  const delivery = config.offlineLan === true ? null : createDelivery(config.smtp!);
  try {
    await delivery?.verify();
    const authentication: EmbeddedAuthenticationRuntimePolicy = {
      config: config.authentication,
      emailDelivery: delivery ?? {
        async sendMagicLink(): Promise<void> {
          throw new Error("offline LAN sign-in requires a local invitation");
        },
      },
      offlineLan: config.offlineLan === true,
    };
    const runtime = await createHostedApiRuntime(
      config.core,
      authentication,
      {
        webManual: config.webManual,
        ...(config.webPush === undefined ? {} : { webPush: config.webPush }),
        ...(config.timeTrialSubmissionAuthorizer === undefined
          ? {}
          : { timeTrialSubmissionAuthorizer: config.timeTrialSubmissionAuthorizer }),
        ...(config.tournamentSubmissionAuthorizer === undefined
          ? {}
          : { tournamentSubmissionAuthorizer: config.tournamentSubmissionAuthorizer }),
        ...(config.operationalLog === undefined
          ? {}
          : { operationalLog: config.operationalLog }),
        ...(config.appDownloads === undefined
          ? {}
          : { appDownloads: config.appDownloads }),
        ...(config.gameAssets === undefined
          ? {}
          : { gameAssets: config.gameAssets }),
        ...(config.staticWeb === undefined
          ? {}
          : { staticWeb: config.staticWeb }),
        ...(config.publicBundle === undefined
          ? {}
          : { publicBundle: config.publicBundle }),
      },
    );
    let closed = false;
    return {
      ...runtime,
      async close(): Promise<void> {
        if (closed) { return; }
        closed = true;
        try {
          await runtime.close();
        } finally {
          delivery?.close();
        }
      },
    };
  } catch (error) {
    delivery?.close();
    throw error;
  }
}
