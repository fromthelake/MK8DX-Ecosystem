// Node resolve hook for the parity scripts: the shared modules import each other without an
// extension (as Vite and the Android build expect); resolve such relative imports to .ts.
export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier)) specifier += '.ts';
  return next(specifier, context);
}
