Short description of files:

- padding.ts:
  Adds padding bytes to Uint8Arrays, so that they have a fixed length. Will be moved moved somewhere else soon, because
  it is also needed by EncryptedConnection
- PasswordRecovery.ts:
  Low level functions that do the encryption / decryption of client and server steps. Does not store anything, just
  indipendent collection of functions that do math stuff. Only uses hex conversion stuff from one.core.
- PasswordRecoveryClient.ts:
  Functions used by clients for password recovery (Three steps, create info, send info to server, restore password)
  Uses the SettingsStore (LocalStorage on browser, File on node) to store the necessary info. Easy to use interface for
  applications.
- PasswordRecoveryServer.ts:
  The server that accepts recovery info payloads and writes the decrypted payloads to disk, so that an operator can
  send that information to the person that wants to restore their passwords.

For executable examples see tools/PasswordRecoveryService folder.
