// Diagnostics go to stderr so stdout stays valid JSON.
export const log = (...args) => process.stderr.write(args.join(' ') + '\n')
