import { type Request, type Response,Router } from "express";

import { asyncHandler } from "../../middleware/async-handler.js";
import { ValidationError } from "../../shared/errors.js";
import {
  getPusherClient,
  isAllowedAuthChannel,
  isValidPusherChannelName,
  isValidPusherEventName,
  triggerPusher,
  usePrivatePusherChannels,
} from "../../shared/pusher.js";
import { validatePusherAuthInput, validatePusherTestInput } from "./realtime.schemas.js";

export const realtimeRouter = Router();

/**
 * Pusher auth endpoint for private/presence channels.
 *
 * IMPORTANT:
 * - This backend supports optional API auth via `API_AUTH_TOKEN(S)`, but it has no
 *   user/org membership system yet.
 * - When API auth is disabled, this endpoint only enforces channel naming rules.
 * - For real security, add auth + membership checks or proxy this endpoint through
 *   a trusted Next.js API route.
 */
realtimeRouter.post(
  "/pusher/auth",
  asyncHandler(async (req: Request, res: Response) => {
    const input = validatePusherAuthInput(req.body);

    const channelCheck = isValidPusherChannelName(input.channel_name);
    if (!channelCheck.ok) {
      throw new ValidationError(channelCheck.error);
    }

    if (!isAllowedAuthChannel(input.channel_name)) {
      return res.status(403).json({
        success: false,
        error: "Channel not allowed",
      });
    }

    const pusher = getPusherClient();
    if (!pusher) {
      return res.status(503).json({
        success: false,
        error: "Pusher not configured",
      });
    }

    const isPresence = input.channel_name.startsWith("presence-");
    if (isPresence && !input.user_id) {
      throw new ValidationError("user_id is required for presence channels");
    }

    // Pusher expects the raw auth response (not wrapped in {success:true}).
    const auth = pusher.authorizeChannel(
      input.socket_id,
      input.channel_name,
      isPresence
        ? {
            user_id: input.user_id!,
            user_info: input.user_info || {},
          }
        : undefined
    );

    return res.json(auth);
  })
);

/**
 * Pusher test endpoint - publishes a simple event so the frontend can validate setup quickly.
 */
realtimeRouter.post(
  "/pusher/test",
  asyncHandler(async (req: Request, res: Response) => {
    const input = validatePusherTestInput(req.body);

    const channel =
      input.channel ||
      (usePrivatePusherChannels() ? "private-realtime-test" : "realtime-test");
    const event = input.event || "realtime.test";
    const payload =
      input.payload ?? { message: "hello from backend", ts: new Date().toISOString() };

    const channelCheck = isValidPusherChannelName(channel);
    if (!channelCheck.ok) {throw new ValidationError(channelCheck.error);}

    const eventCheck = isValidPusherEventName(event);
    if (!eventCheck.ok) {throw new ValidationError(eventCheck.error);}

    const result = await triggerPusher({ channels: [channel], event, payload });
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      channel,
      event,
      payload,
    });
  })
);


