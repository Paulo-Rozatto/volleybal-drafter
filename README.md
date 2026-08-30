# 🏐 Cortada — Setup & Configuração

## 🚀 Instalação Rápida

```bash
git clone https://github.com/seu-usuario/cortada.git
cd cortada
npm install
npm start

```

---

## 🔑 Configuração do Token Criptografado

Para usar a sincronização com o GitHub Gist em qualquer dispositivo sem expor seu token publicamente, siga estes 3 passos:

### 1. Gerar o Token no GitHub

1. Vá em **GitHub** > **Settings** > **Developer Settings** > **Personal Access Tokens (Classic)**.
2. Clique em **Generate new token (classic)**.
3. Marque apenas a permissão **`gist`** e gere o token (ex: `ghp_abc123...`).

### 2. Criptografar o Token no Navegador

Com o projeto rodando localmente, abra o **Console do Navegador** (`F12` > *Console*) e execute:

```javascript
import('./src/cryptoUtils.js').then(m => 
  m.encryptToken('SEU_GITHUB_PAT_AQUI', 'SUA_SENHA_OU_PIN_AQUI')
).then(console.log);

```

Copie a string Base64 gerada (ex: `"e3B4S2d3YUZ2...=="`).

> ⚠️ Guarde a **senha/PIN** usada aqui. Ela será digitada na interface do app para desbloquear o salvamento.

### 3. Inserir a String em `src/App.jsx`

Abra o arquivo `src/App.jsx` e cole o ID do Gist e o token criptografado:

```javascript
// src/App.jsx

const GIST_ID = 'a5b372891eacaf9da30f5f0fc9166bd2';
const ENCRYPTED_GITHUB_TOKEN = 'STRING_GERADA_NO_PASSO_2';

```

---

## 💻 Uso no App

1. Clique em **Carregar do Gist** para puxar o elenco salvo.
2. Faça as alterações no elenco ou faça os sorteios.
3. Para salvar, digite a sua **Senha/PIN** na caixa de texto e clique em **💾 Salvar no Gist**.