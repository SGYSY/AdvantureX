import "dotenv/config";
import express from "express";
import cors from "cors";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const secret = required("WINGMAN_SHARED_SECRET");
const spectrum = await Spectrum({
  projectId: required("PROJECT_ID"),
  projectSecret: required("PROJECT_SECRET"),
  providers: [imessage.config()],
});
const imessagePlatform = imessage(spectrum);
const api = express();
api.use(cors()); api.use(express.json());
api.use((req, res, next) => req.header("X-Wingman-Secret") === secret ? next() : res.status(401).json({detail:"Unauthorized"}));

async function sendPrivateMessage(to: string, text: string): Promise<string | null> {
  const recipient = await imessagePlatform.user(to);
  const dm = await imessagePlatform.space.create(recipient);
  const sent = await dm.send(text);
  return Array.isArray(sent) ? (sent.at(-1)?.id ?? null) : (sent?.id ?? null);
}

api.get("/health", (_, res) => res.json({ok:true, provider:"imessage"}));
api.post("/send", async (req, res) => {
  const { to, text } = req.body as {to?: string; text?: string};
  if (!to || !text) return res.status(422).json({detail:"to and text are required"});
  try {
    const messageId = await sendPrivateMessage(to, text);
    return res.json({mode:"live", message_id: messageId});
  } catch (error) { return res.status(502).json({detail:error instanceof Error ? error.message : "Spectrum delivery failed"}); }
});

async function receiveMessages() {
  for await (const [space, message] of spectrum.messages) {
    const text = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const sender = String(message.sender?.id ?? "");
    const response = await fetch(`${process.env.WINGMAN_BACKEND_URL ?? "http://127.0.0.1:8000"}/api/v1/photon/inbound`, {
      method:"POST", headers:{"Content-Type":"application/json", "X-Wingman-Key":process.env.WINGMAN_API_KEY ?? ""},
      body:JSON.stringify({sender, text, message_id:message.id}),
    });
    const data = await response.json() as {reply?: string};
    if (response.ok && data.reply) await space.send(data.reply);
  }
}
receiveMessages().catch(error => console.error("Spectrum receive loop failed", error));
api.listen(Number(process.env.PORT ?? 8787), () => console.log("Wingman Photon bridge listening"));
