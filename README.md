<p align="center">
  <img src="branding/app.svg" width="200" height="200" alt="Ícone do No Ponto">
</p>

<h1 align="center">No Ponto</h1>

<p align="center">
  <strong>No Ponto</strong> é um aplicativo desktop multiplataforma para acompanhar sua jornada de trabalho, importando os registros de ponto direto da API do PontoMais.<br>
  Construído com Tauri 2 e Angular 20.
</p>

<p align="center">
  <a href="https://github.com/gabrielgriffo/no-ponto-desktop">
    <img src="https://img.shields.io/badge/GitHub-gabrielgriffo%2Fno--ponto--desktop-blue?logo=github" alt="GitHub">
  </a>
</p>

## Tecnologias

- **Frontend**: Angular 20 (TypeScript)
- **Backend**: Rust via Tauri 2
- **Integração com o PontoMais**: [`reqwest`](https://crates.io/crates/reqwest)
- **Armazenamento de credenciais**: [`keyring`](https://crates.io/crates/keyring) (nativo do sistema)

## Pré-requisitos

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (toolchain stable)
- [Pré-requisitos do Tauri CLI](https://v2.tauri.app/start/prerequisites/) para o seu sistema
- No Linux: `gnome-keyring` (ou outro provedor Secret Service) para guardar as credenciais

## Primeiros Passos

```bash
# Instalar as dependências
npm install

# Iniciar o ambiente de desenvolvimento completo (Angular + Tauri)
npm run tauri dev

# Iniciar apenas o frontend Angular (http://localhost:1420)
npm run start
```

## Build

```bash
# Compilar apenas o frontend Angular
npm run build

# Compilar o aplicativo desktop de produção (gera o instalador)
npm run tauri build
```

O instalador é gerado em `src-tauri/target/release/bundle/`.

## Estrutura do Projeto

```
├── src/                          # Frontend Angular
│   └── app/
│       ├── components/           # Componentes de UI reutilizáveis
│       ├── pages/                # Tela principal e modal de configurações
│       ├── services/             # PontoMais, credenciais, cálculo de horas
│       ├── app.ts                # Componente raiz
│       ├── app.config.ts         # Configuração de bootstrap da aplicação
│       └── app.routes.ts         # Configuração de rotas
└── src-tauri/                    # Backend Rust/Tauri
    ├── src/
    │   ├── pontomais.rs          # Integração com a API do PontoMais
    │   ├── auto_sync.rs          # Timer de sincronização em segundo plano
    │   ├── settings.rs           # Persistência das configurações
    │   ├── credentials.rs        # Acesso ao keyring do sistema
    │   ├── external_app.rs       # Inicialização de aplicativo externo
    │   ├── app_info.rs           # Metadados do aplicativo
    │   ├── lib.rs                # Registro dos comandos Tauri
    │   └── main.rs               # Ponto de entrada
    └── tauri.conf.json           # Configuração de janela e empacotamento
```

## Licença

MIT © [Gabriel Griffo](https://github.com/gabrielgriffo)
