import type { AuthContext } from "../shared/auth-context.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};

