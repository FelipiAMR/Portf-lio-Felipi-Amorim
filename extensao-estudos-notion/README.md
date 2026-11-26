# 📚 Estudaí: resumos de aula direto no Notion

Extensão do Chrome que, **enquanto você assiste às aulas**, captura o que o professor fala. Quando você termina, ela gera com o Claude um **resumo + explicação bem didática** e cria uma **pasta da aula no Notion**.

## Como fica no Notion

```
📄 Meus Estudos            ← página raiz que você escolhe
└── 📚 Nome do curso
    └── 📂 Módulo (opcional)
        └── 🎬 Aula 3 - useState          ← uma pasta por aula
            ├── 📘 Resumo e explicação
            └── 📝 Transcrição completa (+ suas anotações)
```

A pasta da aula traz um checklist (aula concluída, revisei o resumo, respondi as perguntas).
O **Resumo e explicação** tem estas seções: resumo em uma frase, resumo da aula, conceitos explicados (o que é, uma analogia, por que existe e um exemplo com código comentado), passo a passo do que foi feito, pegadinhas, glossário, perguntas de revisão (em blocos que abrem e fecham, para treinar) e exercícios para fixar.

## Instalação (5 minutos)

1. Baixe esta pasta `extensao-estudos-notion`.
2. No Chrome, abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta.
4. Fixe o ícone 📚 na barra do navegador.

## Configuração

Clique no ícone e depois em ⚙️:

1. **Chave do Claude**: crie em <https://console.anthropic.com> → *API Keys*.
2. **Notion**:
   - Acesse <https://www.notion.so/my-integrations> → **Nova integração** (interna) e copie o token.
   - No Notion, crie uma página (ex.: "Meus Estudos"), clique em `•••` → **Conexões** e adicione a sua integração.
   - Cole o link dessa página nas configurações.
3. **Nome do curso**: vira a pasta do curso.
4. Clique em **Testar conexão com o Notion**.

## Uso no dia a dia

1. Abra a aula e **ligue as legendas (CC)** do player.
2. Clique em 📚 → **Começar captura** e assista normalmente. Pode fechar o popup.
3. No fim, clique em **Terminei a aula: gerar resumo e salvar no Notion**.
4. Em 1 a 3 minutos aparece o link da página no Notion.
5. Clique em **Limpar e começar próxima aula** antes da próxima aula.

### E se a aula não tiver legenda?

Escolha o modo **Áudio da aba**. Ele grava o som da aba e transcreve a cada minuto com o Whisper (OpenAI). Para isso é preciso uma chave da OpenAI nas configurações, porque o Claude não transcreve áudio. Você continua ouvindo a aula normalmente.

Também dá para colar uma transcrição pronta no campo de anotações.

## Custos aproximados

- Legendas: grátis.
- Claude Opus 5.5: cerca de US$ 0,10 a 0,30 por aula de 30 a 60 min. O Sonnet 5.5 custa metade.
- Whisper (só no modo áudio): cerca de US$ 0,006 por minuto.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `content.js` | Lê as legendas do `<video>` e dos players (Vimeo, YouTube, video.js etc.), inclusive dentro de iframes |
| `background.js` | Guarda a transcrição e orquestra a geração e o envio |
| `claude.js` | Prompt didático e chamada à API do Claude |
| `notion.js` | Cria as pastas e converte Markdown em blocos do Notion |
| `offscreen.js` | Modo áudio: grava a aba e transcreve |
| `popup.*` / `options.*` | Interface |

As chaves ficam salvas apenas no seu navegador (`chrome.storage.local`).
