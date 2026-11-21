import * as Electron from "electron";

type ProtocolClientApp = Pick<Electron.App, "setAsDefaultProtocolClient">;

// fork: runs create while URL scheme registration is a no-op, so the installed app keeps its handler.
export const withoutProtocolRegistration = <A>(
  skip: boolean,
  create: () => A,
  app: ProtocolClientApp = Electron.app,
): A => {
  if (!skip) return create();
  const original = app.setAsDefaultProtocolClient;
  app.setAsDefaultProtocolClient = () => false;
  try {
    return create();
  } finally {
    app.setAsDefaultProtocolClient = original;
  }
};
