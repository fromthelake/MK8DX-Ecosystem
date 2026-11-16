# Jogadores: o site e a aplicação Android

*Esta é uma tradução automática do [guia em inglês](../../PLAYERS.md); a versão inglesa é a que prevalece. As correções são bem-vindas através do formulário de issue «Translation correction».*

[Todos os guias](../../../../README.md#get-started)

Precisas do endereço do site MK8DX da tua comunidade, por exemplo `https://www.example.org`. Cada comunidade
gere a sua própria instalação, com as suas próprias contas e resultados; pede o endereço às pessoas que gerem a tua
e também ajuda com a tua conta. Não precisas de instalar nada para usar o site.

## O site

### Iniciar sessão

1. Abre o endereço da tua comunidade e escolhe o ícone da conta (canto superior direito) e depois **Iniciar sessão**.
2. Introduz o teu endereço de e-mail e escolhe **Enviar-me uma ligação por e-mail**. Abre o e-mail e segue a ligação. Não há
   palavra-passe. A ligação funciona uma vez e expira; pede uma nova se não funcionar.
3. Da primeira vez, a ligação abre diretamente uma configuração em três passos. O passo 1, **Já estás neste site?**,
   pergunta se os teus tempos de Contrarrelógio já estão no site e se participaste num torneio aí listado.
   Se sim, o passo 2 permite-te encontrar o Jogador que és tu e pedir que seja associado à tua conta; um
   administrador ou o Diretor de Torneio da noite analisa esse pedido antes de o associar, e nada é
   associado apenas pelo nome. Se não, o passo 2 cria o teu Jogador (numa comunidade onde só os Diretores criam
   Jogadores, explica a quem deves pedir). O passo 3 oferece algumas definições opcionais que podes saltar.

A tua conta (o e-mail com que inicias sessão) e o teu Jogador (o nome nas tabelas de classificação) são coisas diferentes.

### Publicar um tempo de Contrarrelógio

- **Publicar um tempo** (barra superior), ou **Pistas** → uma pista → **Publicar um tempo**: introduz o teu tempo em 150cc ou 200cc, verifica
  os valores na confirmação e publica.
- **Lê-o com a câmara**: abre `<your community address>/scanner/` num telemóvel ou tablet. Aponta a câmara para o ecrã
  de resultados na tua TV, ou escolhe **carregamento de imagem** com uma fotografia ou captura de ecrã. O leitor lê os tempos, as voltas
  e, quando visíveis, a personagem, a configuração do kart e a bandeira. Verifica cada valor antes de submeteres; o reconhecimento pode
  enganar-se. A câmara precisa de um endereço HTTPS de confiança (também funciona em `localhost`); o carregamento de imagem funciona em qualquer lado.
- Conforme as regras da comunidade, uma submissão pode ser publicada de imediato ou aguardar a revisão de um
  administrador. Um administrador pode corrigir ou retirar um tempo publicado.

### Acompanhar o teu progresso

**Pistas**, **Ranking** e **Recordes** mostram os teus melhores tempos e voltas ao lado da comunidade, dos rivais que escolheste,
dos fantasmas da equipa da Nintendo e dos recordes mundiais. **Configuração** ajuda com as configurações de personagem e kart, **Comunidade**
mostra outros Jogadores e **Torneios** as noites de torneio publicadas, classificações e relatórios. Quando alguém
bate um dos teus tempos publicados, recebes uma notificação (o sino). O site também pode enviar notificações push do navegador
se a tua comunidade o tiver configurado; ativa-as nas definições da tua conta.

O site está disponível nos 15 idiomas do jogo (escolhe o teu nas definições). O inglês e o neerlandês estão
revistos; os outros 13 são traduções automáticas, e as correções são bem-vindas: vê
[Change UI text and translations](../../../DEVELOPMENT.md#change-ui-text-and-translations) para o ficheiro a editar e
[Contributing](../../../../.github/CONTRIBUTING.md) para o pull request.

## A aplicação Android

A aplicação oferece uma leitura mais rápida no próprio telemóvel, os teus tempos e notificações. É opcional.

### Requisitos

- Android 8.0 ou mais recente; recomenda-se um telemóvel arm64. O APK de lançamento é grande (cerca de 530 MB): mantém cerca de
  1 GB livre durante a instalação.
- Uma comunidade a que a aplicação consiga chegar: uma **comunidade online** com um endereço HTTPS de confiança, ou uma **instalação
  em casa ou no clube** (A2) no mesmo Wi-Fi. Um endereço local do computador (`http://127.0.0.1:…`) não funciona na aplicação.

### Instalar

1. Obtém o APK na página **Obter a app** da tua comunidade, quando ela oferece transferências (tens de ter sessão iniciada para as
   ver; é a versão que a tua comunidade suporta), ou na página
   [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) do projeto: escolhe
   `mk8dx-android-release-….apk`. Com um clone do repositório também podes compilar tu o APK:
   [Client builds](../../../CLIENT_BUILDS.md#android).
2. Verifica o ficheiro com `SHA256SUMS.txt` da mesma versão (num computador: `Get-FileHash` no PowerShell,
   `sha256sum` no Linux, `shasum -a 256` no macOS).
3. Copia o APK para o telemóvel e abre-o a partir de **Ficheiros** ou **Transferências**. O Android pede para permitir instalações a partir
   dessa aplicação; permite-o só para este ficheiro verificado e, se quiseres, desativa-o de novo a seguir.

Esta não é uma aplicação da Play Store. Os APK públicos anteriores eram assinados com uma chave de compilação de depuração; o APK de lançamento usa a
chave mantida pelo responsável do projeto. Guarda os resultados ainda não enviados e desinstala uma vez um APK de depuração anterior antes de instalares
esta versão. Os APK posteriores assinados com a mesma chave de lançamento atualizam no lugar. Mudar para o APK de uma comunidade ou para um
APK compilado por ti com outra chave também obriga a desinstalar.

### Primeiro arranque

A aplicação abre em **Escolhe a tua comunidade**, no idioma do telemóvel, quando a aplicação o tem. Para escolher outro
idioma, toca em **Idioma / Language** (com o globo) no topo; a aplicação guarda essa escolha. Depois pergunta uma coisa:
como joga a tua comunidade. Não tens a certeza? Pergunta à
pessoa que gere a tua comunidade.

- **Em casa ou no clube** (A2, o MK8DX funciona num computador aí): toca em **Ler o código QR** e lê o
  cartão **Prepare a device** (preparar um dispositivo) que o teu administrador mostra nesse computador ou distribui em papel. O telemóvel tem de estar
  no mesmo Wi-Fi. A aplicação mostra então o endereço e a chave da instalação; também estão na página **Prepare this
  device** (preparar este dispositivo), em **Full fingerprints** (impressões digitais completas). Toca em **Ligar** quando forem iguais. Não precisas de internet. Passo a passo:
  [o guia A2, capítulo 7](../../../install/translations/pt/A2_HOME_GUIDE.md#7-a-aplicação-android-e-o-livetrial).
- **Comunidade online** (um site na internet): introduz o endereço com que o abres no navegador, por exemplo
  `https://www.example.org` (sem caminho, sem barra final), e toca em **Guardar**. Se falhar, abre o mesmo endereço no
  navegador do telemóvel: tem de abrir sem aviso de certificado.

Em casa ou no clube (A2), compara primeiro o código de instalação de 16 caracteres e toca em **Ligar**. Segue os passos da aplicação: **Guardar certificado**, **Abrir definições** para o instalar como certificado de AC e **Ler cartão de início de sessão** para entrar na própria aplicação. Não é preciso um código no navegador. Numa comunidade online, toca no ícone de pessoa e em **Iniciar sessão**; a aprovação é feita no navegador.

### Orientar-te

O topo da aplicação mostra o logótipo (de volta ao Início), o **chip da comunidade** com o nome da comunidade que estás a
usar, o sino e o teu nome. O teu nome abre **Tu**: o teu Jogador com **Mudar de Jogador**, e os separadores
**Meus tempos**, **Recordes** e **Rivais**, com uma linha **Definições** por baixo.

- **Várias comunidades**: toca no chip da comunidade para abrir **Comunidades**. A ativa está a verde; **Mudar de comunidade**
  muda para outra com um toque, **Remover deste telefone** esquece uma (só quando nada estiver à espera de ser enviado), e
  **Adicionar uma comunidade** abre de novo o ecrã do primeiro arranque. Cada comunidade guarda o seu próprio início de sessão, as suas próprias tentativas
  por enviar e, em casa ou no clube, a sua própria confiança; nada passa de uma para outra sozinho. Quando o administrador
  deu um nome à comunidade, a aplicação mostra esse nome em vez do endereço.
- **Meus tempos** é uma lista: os números da tua carreira e depois uma linha por pista e categoria com o teu recorde pessoal; toca numa
  linha para ver tentativas mais antigas e usa **⋯** numa tentativa para **Detalhes**, **Editar**, **Retirar** ou
  **Levar para outra comunidade…**.
- **Sem internet**: a aplicação guarda uma cópia dos teus próprios tempos e dos melhores tempos dos teus rivais por comunidade e
  mostra-a com «Offline — última atualização …».
- **À espera de envio**: as tentativas que ainda só estão no telemóvel aparecem como uma faixa laranja no Início e em Tu; toca nela,
  ou usa Definições › **Guardado neste telefone**, para as veres.
- **Definições** está agrupado em **Jogador**, **App**, **Comunidade** e **Sobre**, e guarda cada alteração sozinho.
  O idioma está em App; **Obter a app** e **Guardado neste telefone** estão em Comunidade; **Fazer uma leitura de teste**
  está em Sobre.

### Levar tempos para outra comunidade

Se pertences a mais do que uma comunidade, um tempo também pode contar noutra: **Levar para outra comunidade…**
numa tentativa, ou **Levar os meus melhores tempos** por baixo dos números da tua carreira em Meus tempos (as pistas onde a outra comunidade
já tem um tempo teu melhor são saltadas). A cópia espera até teres sessão iniciada lá. A comunidade **que recebe**
decide: por predefinição não aceita tempos de outros sítios, pode deixar um administrador aprovar cada um
primeiro, ou pode aceitá-los como qualquer outro tempo. Um tempo trazido mostra sempre de onde veio («Trazido de … ·
originalmente …»). O mesmo original só é aceite uma vez; um tempo igual apenas preenche o que faltava à tentativa
existente.

### Notificações

As notificações na aplicação são obtidas da caixa de entrada da tua comunidade; a autorização de notificações do Android e o
interruptor da própria aplicação têm de estar ambos ativados.

## Problemas

- Não chega o e-mail de início de sessão: verifica o spam e o endereço exato e pede uma nova ligação. Numa instalação de teste local, o
  e-mail chega à caixa de entrada de teste local, não à tua caixa de correio.
- Uma reivindicação é recusada com *Demasiadas ações de reivindicação neste momento…*: espera o tempo indicado e tenta
  novamente. Uma conta pode ter no máximo 5 reivindicações à espera de decisão ao mesmo tempo (um jogador no máximo 5
  de todas as contas juntas). Atingido esse limite, espera até que uma reivindicação pendente seja tratada, ou retira
  uma com **Retirar este pedido**, e tenta novamente.
- Algo parece errado no site da tua comunidade: pergunta primeiro às pessoas que o gerem. Os erros no próprio software
  podem ser comunicados nas issues do projeto; vê [SUPPORT.md](../../../../.github/SUPPORT.md). Nunca publiques ligações de início de sessão nem os nomes de outras
  pessoas.
