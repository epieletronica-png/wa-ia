export function wantsTechnician(text) {
  const t = (text || "").toLowerCase();
  return ["técnico", "tecnico", "assistência", "atendente", "humano"].some(k => t.includes(k));
}

export function parseCommand(text) {
  const t = (text || "").trim();

  if (t.startsWith("/respraw ")) {
    const [, to, ...msg] = t.split(" ");
    return { type: "reply_raw", to, msg: msg.join(" ") };
  }

  if (t.startsWith("/resp ")) {
    const [, to, ...msg] = t.split(" ");
    return { type: "reply", to, msg: msg.join(" ") };
  }

  if (t.startsWith("/enviar ")) {
    const [, to] = t.split(" ");
    return { type: "send", to };
  }

  if (t.startsWith("/fechar ")) {
    const [, to] = t.split(" ");
    return { type: "close", to };
  }

  if (t === "/abertos") return { type: "list" };

  return { type: "none" };
}
