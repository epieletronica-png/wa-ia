import { gerarResposta } from "./ai.js";

/**
 * Reescreve a mensagem do atendente para ficar formal, direta e clara,
 * mantendo o sentido e sem inventar informações.
 */
export async function polishAgentText(original) {
  const msgs = [
    {
      role: "system",
      content:
        "Você é um revisor de texto para atendimento ao cliente. " +
        "Reescreva a mensagem do atendente em português formal, direto e objetivo. " +
        "Não use emojis. Não use gírias. Não invente informações. " +
        "Mantenha o sentido original. Se a mensagem já estiver adequada, devolva como está."
    },
    { role: "user", content: original }
  ];

  const polished = await gerarResposta(msgs);

  if (!polished || polished.trim().length < 3) return original;
  return polished.trim().slice(0, 1500);
}
