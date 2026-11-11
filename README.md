<div align="center">
  <h1>
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="branding/banner-dark.svg" />
      <img src="branding/banner.svg" width="360" alt="No Ponto" />
    </picture>
  </h1>

  <p>
    No Ponto é um aplicativo desktop multiplataforma para acompanhar sua jornada de trabalho, importando os registros de ponto direto da API do PontoMais.<br>
  </p>

[![Release](https://img.shields.io/github/v/release/gabrielgriffo/no-ponto-desktop?color=blue)](https://github.com/gabrielgriffo/no-ponto-desktop/releases/latest) [![License](https://img.shields.io/github/license/gabrielgriffo/no-ponto-desktop?label=license&color=yellow)](LICENSE) [![Built with Rust](https://img.shields.io/badge/built_with-Rust-orange)](https://www.rust-lang.org/)

  <p>
    <a href="https://github.com/gabrielgriffo/no-ponto-desktop/releases">
      <img src="https://img.shields.io/badge/Download-Windows_·_Linux-6b7280?style=for-the-badge&logo=github&logoColor=white&labelColor=16a34a" alt="Baixar o No Ponto" /></a>
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
