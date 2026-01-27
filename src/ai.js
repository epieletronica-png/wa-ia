import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function gerarResposta(mensagens) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: mensagens,
    temperature: 0.6
  });

  return res.choices?.[0]?.message?.content || "";
}
