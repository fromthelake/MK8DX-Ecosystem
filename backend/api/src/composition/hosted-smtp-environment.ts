/** Decode the installer's private dotenv-safe SMTP password without printing it. */
export function hostedSmtpEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const encoded = environment["MK8DX_HOSTED_SMTP_PASSWORD_BASE64"];
  if (encoded === undefined) return environment;
  const password = Buffer.from(encoded, "base64");
  if (password.toString("base64") !== encoded ||
      Buffer.from(password.toString("utf8"), "utf8").compare(password) !== 0) {
    throw new Error("MK8DX_HOSTED_SMTP_PASSWORD_BASE64 is invalid");
  }
  return { ...environment, MK8DX_HOSTED_SMTP_PASSWORD: password.toString("utf8") };
}
