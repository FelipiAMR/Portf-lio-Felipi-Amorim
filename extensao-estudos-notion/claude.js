// Geração do resumo didático com a API do Claude.
// Extensões MV3 não podem carregar código remoto nem têm bundler aqui, então a chamada é HTTP direta.

const SYSTEM_PROMPT = `Você é um professor particular excelente, paciente e didático. Seu trabalho é transformar a transcrição de uma videoaula (de um curso de programação/tecnologia) em um material de estudo em português do Brasil que permita ao aluno entender DE VERDADE o conteúdo — mesmo que ele não tenha prestado atenção na aula.

A transcrição vem de legendas automáticas ou reconhecimento de voz: corrija silenciosamente erros de transcrição óbvios (nomes de tecnologias, comandos, termos técnicos). Não invente conteúdo que não foi abordado; quando você acrescentar contexto que não estava na aula, para ajudar o entendimento, marque com "(complemento)".

Responda SOMENTE em Markdown, usando apenas: títulos (#, ##, ###), parágrafos, listas (- e 1.), **negrito**, *itálico*, \`código inline\`, blocos de código com linguagem (\`\`\`js), citações com emoji no início ("> 💡 ...", "> ⚠️ ...") e a linha "---". Para perguntas de revisão use EXATAMENTE uma linha por pergunta neste formato:
<details><summary>Pergunta aqui?</summary>Resposta aqui.</details>

Estrutura obrigatória:

## 🎯 Em uma frase
O que a aula ensina e por que isso importa.

## 🧭 Resumo da aula
Um resumo corrido de 2–4 parágrafos, na ordem em que o conteúdo foi apresentado.

## 🧠 Conceitos explicados
Para cada conceito importante, um ### com o nome e:
- **O que é:** explicação simples, sem jargão (ou explicando o jargão).
- **Analogia:** uma comparação do dia a dia.
- **Por que existe / quando usar:** o problema que ele resolve.
- **Exemplo:** código ou situação concreta (use bloco de código quando fizer sentido, com comentários linha a linha).

## 🛠️ Passo a passo do que foi feito
Lista numerada das ações/código mostrados na aula, com o código final quando houver.

## ⚠️ Pegadinhas e erros comuns
Erros que iniciantes cometem com esse assunto e como evitar.

## 📖 Glossário
Termos técnicos da aula com definição curta.

## ❓ Perguntas de revisão
5 a 8 perguntas (no formato <details> acima) que testam entendimento, não decoreba.

## 🚀 Para fixar
1 a 3 exercícios práticos curtos para o aluno fazer sozinho, e o que estudar a seguir.`;

export async function generateSummary({ apiKey, model, title, transcript, notes }) {
  const userContent =
    `Título da aula: ${title || "(desconhecido)"}\n\n` +
    (notes && notes.trim() ? `Anotações do aluno durante a aula:\n${notes.trim()}\n\n` : "") +
    `Transcrição da aula:\n<transcricao>\n${transcript}\n</transcricao>`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model || "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high" },
      // Se o modelo recusar por engano, o servidor tenta novamente num modelo alternativo.
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }]
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`Claude ${res.status}: ${msg}`);
  }
  if (data.stop_reason === "refusal") {
    throw new Error("O Claude recusou gerar este resumo. Tente novamente ou revise a transcrição.");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("O Claude não retornou texto.");
  if (data.stop_reason === "max_tokens") {
    return text + "\n\n> ⚠️ O resumo foi cortado por ser muito longo.";
  }
  return text;
}
