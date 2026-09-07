<div align="center">
  <p>
    <img src="branding/app.svg" width="120" height="120" alt="No Ponto" />
  </p>

  <h1>No Ponto</h1>

  <p>
    No Ponto é um aplicativo desktop multiplataforma para acompanhar sua jornada de trabalho, importando os registros de ponto direto da API do PontoMais.<br>
    Construído com Tauri 2 e Angular 20.<br>
    <sub>Projeto independente, sem qualquer vínculo com a PontoMais. Veja o <a href="#aviso-legal">Aviso Legal</a>.</sub>
  </p>

  <p>
    <a href="https://github.com/gabrielgriffo/no-ponto-desktop/actions/workflows/release.yml">
      <img
        src="https://img.shields.io/github/actions/workflow/status/gabrielgriffo/no-ponto-desktop/release.yml?label=CI&style=flat-square"
        alt="CI" /></a>
    <a href="https://github.com/gabrielgriffo/no-ponto-desktop/releases/latest">
      <img
        src="https://img.shields.io/github/v/release/gabrielgriffo/no-ponto-desktop?label=release&style=flat-square&color=2563eb"
        alt="Release" /></a>
    <a href="LICENSE">
      <img
        src="https://img.shields.io/github/license/gabrielgriffo/no-ponto-desktop?label=license&style=flat-square&color=6b7280"
        alt="License" /></a>
  </p>
  <p>
    <a href="https://github.com/gabrielgriffo/no-ponto-desktop/releases">
      <img src="https://img.shields.io/badge/Download-Windows_·_Linux-16a34a?style=for-the-badge&logo=github&logoColor=white" alt="Baixar o No Ponto" /></a>
  </p>
</div>

## Tecnologias

- **Interface:** Angular 20 e TypeScript
- **Aplicativo desktop:** Rust e Tauri 2
- **Integração com a API:** [`reqwest`](https://crates.io/crates/reqwest)
- **Armazenamento de credenciais:** [`keyring`](https://crates.io/crates/keyring), utilizando o armazenamento seguro nativo do sistema operacional

## Executando localmente

Pré-requisitos:

- [Node.js](https://nodejs.org/) 20 ou superior
- [Rust](https://www.rust-lang.org/tools/install) com a toolchain `stable`
- [Pré-requisitos do Tauri](https://v2.tauri.app/start/prerequisites/) para o sistema operacional utilizado
- No Linux: `gnome-keyring` ou outro provedor compatível com o padrão Secret Service para o armazenamento seguro das credenciais

```bash
# Instalar as dependências
npm install

# Iniciar o ambiente de desenvolvimento (Angular + Tauri)
npm run tauri dev

# Gerar a compilação de produção
npm run tauri build
```

Os arquivos de distribuição são gerados em `src-tauri/target/release/bundle/`.

## Estrutura do Projeto

```
├── src/                              # Aplicação Angular
│   └── app/
│       ├── components/               # Componentes de interface reutilizáveis
│       ├── pages/                    # Páginas e telas da aplicação
│       ├── services/                 # Serviços e regras de negócio
│       ├── app.ts                    # Componente raiz
│       ├── app.config.ts             # Configuração da aplicação
│       └── app.routes.ts             # Configuração das rotas
│
└── src-tauri/                        # Aplicação Rust/Tauri
    ├── src/
    │   ├── pontomais.rs              # Integração com a API do PontoMais
    │   ├── auto_sync.rs              # Sincronização periódica em segundo plano
    │   ├── settings.rs               # Persistência das configurações
    │   ├── credentials.rs            # Acesso ao armazenamento seguro de credenciais
    │   ├── external_app.rs           # Integração com aplicativos externos
    │   ├── app_info.rs               # Metadados da aplicação
    │   ├── lib.rs                    # Registro dos comandos Tauri
    │   └── main.rs                   # Ponto de entrada
    │
    └── tauri.conf.json               # Configuração e empacotamento
```

## Privacidade e Armazenamento de Dados

O No Ponto é um aplicativo de execução local. Ele não utiliza servidores próprios, backends intermediários, telemetria ou mecanismos de coleta de dados.

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

Distribuído sob a licença MIT.

MIT © [Gabriel Griffo](https://github.com/gabrielgriffo)
