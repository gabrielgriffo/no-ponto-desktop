<p align="center">
  <img src="branding/app.svg" width="200" height="200" alt="Ícone do No Ponto">
</p>

<h1 align="center">No Ponto</h1>

<p align="center">
  <strong>No Ponto</strong> é um aplicativo desktop multiplataforma para acompanhar sua jornada de trabalho, importando os registros de ponto direto da API do PontoMais.<br>
  Construído com Tauri 2 e Angular 20.<br>
  <sub>Projeto independente, sem qualquer vínculo com a PontoMais. Veja o <a href="#aviso-legal">Aviso Legal</a>.</sub>
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

## Privacidade e Dados

O No Ponto é um aplicativo **100% local**. Ele não utiliza servidores próprios, backends intermediários, telemetria ou qualquer outro mecanismo de coleta de dados.

* As requisições são enviadas **diretamente da sua máquina para a API do PontoMais**, utilizando exclusivamente as suas próprias credenciais.
* Tokens e senhas são armazenados no **keyring nativo do sistema operacional**. Essas informações não são expostas ao webview e não são gravadas em arquivos do aplicativo.
* Os dados relacionados à jornada permanecem somente na sua máquina.
* O aplicativo é **somente leitura**: ele consulta registros já existentes na sua conta e não registra, altera ou exclui nenhuma marcação de ponto.

## Aviso Legal

O No Ponto é um projeto independente, pessoal e sem fins lucrativos. Ele **não possui qualquer afiliação, associação, autorização, endosso ou patrocínio da PontoMais**, de suas subsidiárias ou empresas afiliadas.

As marcas e os nomes mencionados pertencem aos seus respectivos titulares e são utilizados exclusivamente de forma descritiva, para indicar a compatibilidade do aplicativo.

O acesso à API do PontoMais é realizado utilizando exclusivamente as credenciais fornecidas pelo próprio usuário e apenas para consultar os dados da sua própria conta.

> [!WARNING]
> O uso deste aplicativo pode conflitar com os Termos de Uso da plataforma PontoMais. **A responsabilidade pelo uso é inteiramente do usuário**, incluindo eventuais medidas que o provedor possa adotar em relação à conta utilizada. Recomenda-se consultar os termos vigentes e, em caso de dúvida, a área de RH da empresa.

O software é fornecido "como está", sem garantias de qualquer natureza, nos termos da licença MIT. O No Ponto não substitui o sistema oficial de registro de ponto: os dados e valores exibidos têm caráter exclusivamente informativo, e a fonte oficial dos registros de jornada continua sendo o PontoMais.


## Licença

MIT © [Gabriel Griffo](https://github.com/gabrielgriffo)
