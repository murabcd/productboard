import { eveChannel } from "eve/channels/eve";

export default eveChannel({
  auth: (request) => {
    const token = process.env.PRODUCTBOARD_EVE_TOKEN;
    return token && request.headers.get("Authorization") === `Bearer ${token}`
      ? { authenticator: "productboard", principalId: "local-dashboard", principalType: "user", attributes: {} }
      : null;
  },
});
