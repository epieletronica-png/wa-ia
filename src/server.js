import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";

import { sendTextMessage } from "./whatsapp.js";
import { gerarResposta } from "./ai.js";
import { polishAgentText } from "./polish.js";
import {
  getContext, saveContext,
  getMode, setMode,
  openTicket, closeTicket, listTickets,
  savePreview, getPreview, clearPreview
} from "./memory.js";
import { wantsTechnician, parseCommand } from "./handover.js";

dotenv.config();
const app = express();

// Necessário para validar assinatura (precisa do raw body)
app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));

function verifySignature(req) {
  const sig = req.headers["x-hub-signature-256"];
  if (!sig) return false;

  const hmac = crypto
    .createHmac("sha256", process.env.APP_SECRET)
    .update(req.rawBody)
    .digest("hex");

  return sig === `sha256=${hmac}`;
}

app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  if (!verifySignature(req)) return res.sendStatus(401);

  // Responde rápido para a Meta
  res.sendStatus(200);

  const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg?.text?.body) return;

  const from = msg.from;
  const text = msg.text.body.trim();

  // 1) Mensagens do dono/técnico (comandos)
  const isAgent = from === process.env.OWNER_WA_ID || from === process.env.TECH_WA_ID;

  if (isAgent) {
    const cmd = parseCommand(text);

    // /resp (com polimento + prévia) e /respraw (sem polimento)
    if (cmd.type === "reply" || cmd.type === "reply_raw") {
      if (!cmd.to || !cmd.msg) return;

      let finalText = cmd.msg;

      const shouldPolish =
        process.env.POLISH_AGENT_MESSAGES === "true" &&
        cmd.type === "reply";

      if (shouldPolish) {
        try {
          finalText = await polishAgentText(cmd.msg);
        } catch {
          finalText = cmd.msg; // fallback seguro
        }
      }

      // Modo prévia: NÃO envia ao cliente ainda, só salva e mostra para o agente
      if (process.env.AGENT_PREVIEW_MODE === "true") {
        await savePreview(cmd.to, finalText);

        await sendTextMessage({
          to: from,
          text:
            "Prévia da mensagem ao cliente:\n\n" +
            `\"${finalText}\"\n\n` +
            `Para confirmar o envio:\n/enviar ${cmd.to}\n\n` +
            `Para editar manualmente:\n/respraw ${cmd.to} nova mensagem`
        });
        return;
      }

      // Envio direto se prévia estiver desligada
      await sendTextMessage({ to: cmd.to, text: finalText });
      return;
    }

    // /enviar <cliente>
    if (cmd.type === "send") {
      if (!cmd.to) return;

      const preview = await getPreview(cmd.to);
      if (!preview) {
        await sendTextMessage({
          to: from,
          text: "Não há mensagem em prévia para este cliente."
        });
        return;
      }

      await sendTextMessage({ to: cmd.to, text: preview });
      await clearPreview(cmd.to);

      await sendTextMessage({
        to: from,
        text: "Mensagem enviada ao cliente."
      });
      return;
    }

    // /fechar <cliente>
    if (cmd.type === "close") {
      if (!cmd.to) return;
      await closeTicket(cmd.to);

      await sendTextMessage({
        to: cmd.to,
        text: "Atendimento encerrado. Caso precise, envie uma nova mensagem."
      });

      // opcional: confirma ao agente que fechou
      await sendTextMessage({
        to: from,
        text: `Atendimento encerrado para ${cmd.to}.`
      });
      return;
    }

    // /abertos
    if (cmd.type === "list") {
      const list = await listTickets();
      await sendTextMessage({
        to: from,
        text: list.join("\n") || "Nenhum atendimento em aberto."
      });
      return;
    }

    // Se não for comando reconhecido, manda ajuda curta
    await sendTextMessage({
      to: from,
      text:
        "Comandos disponíveis:\n" +
        "/resp 55XXXXXXXXX mensagem (gera prévia)\n" +
        "/enviar 55XXXXXXXXX (confirma envio)\n" +
        "/respraw 55XXXXXXXXX mensagem (envio direto sem polir)\n" +
        "/abertos\n" +
        "/fechar 55XXXXXXXXX"
    });
    return;
  }

  // 2) Pedido de técnico (handover)
  if (wantsTechnician(text)) {
    await setMode(from, "HUMAN");
    await openTicket(from);

    // Mensagem automática ao cliente
    await sendTextMessage({
      to: from,
      text: process.env.HANDOVER_AUTO_TEXT
    });

    // Notifica dono e técnico
    if (process.env.OWNER_WA_ID) {
      await sendTextMessage({
        to: process.env.OWNER_WA_ID,
        text:
          "Solicitação de técnico.\n" +
          `Cliente: ${from}\n` +
          `Mensagem: \"${text}\"\n\n` +
          `Responder: /resp ${from} sua mensagem\n` +
          `Encerrar: /fechar ${from}\n` +
          "Listar: /abertos"
      });
    }

    if (process.env.TECH_WA_ID) {
      await sendTextMessage({
        to: process.env.TECH_WA_ID,
        text:
          "Solicitação de técnico.\n" +
          `Cliente: ${from}\n` +
          `Mensagem: \"${text}\"\n\n` +
          `Responder: /resp ${from} sua mensagem`
      });
    }

    return;
  }

  // 3) Se estiver em modo HUMANO: não usa IA; apenas encaminha nova msg ao dono/técnico
  if ((await getMode(from)) === "HUMAN") {
    if (process.env.OWNER_WA_ID) {
      await sendTextMessage({
        to: process.env.OWNER_WA_ID,
        text:
          "Nova mensagem (atendimento humano).\n" +
          `Cliente: ${from}\n` +
          `Mensagem: \"${text}\"`
      });
    }

    if (process.env.TECH_WA_ID) {
      await sendTextMessage({
        to: process.env.TECH_WA_ID,
        text:
          "Nova mensagem (atendimento humano).\n" +
          `Cliente: ${from}\n` +
          `Mensagem: \"${text}\"`
      });
    }

    return;
  }

  // 4) Modo IA (ChatGPT) formal e direto
  const ctx = await getContext(from);

  const msgs = [
    {
      role: "system",
      content:
        "Você é um atendente profissional de uma loja de assistência técnica. " +
        "Seja formal, direto e objetivo. " +
        "Não use emojis, gírias ou linguagem informal. " +
        "Faça perguntas curtas e claras quando precisar de informações. " +
        "Responda apenas o necessário para resolver a solicitação."
    },
    ...ctx,
    { role: "user", content: text }
  ];

  const reply = await gerarResposta(msgs);

  await sendTextMessage({ to: from, text: reply });

  await saveContext(from, [
    ...ctx,
    { role: "user", content: text },
    { role: "assistant", content: reply }
  ]);
});

app.listen(process.env.PORT, () => console.log("Bot em execução."));
