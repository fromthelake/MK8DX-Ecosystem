# LiveTrial: gravar Contrarrelógio no Windows

*Esta é uma tradução automática do [guia em inglês](../../LIVETRIAL.md); a versão inglesa é a que prevalece. As correções são bem-vindas através do formulário de issue «Translation correction».*

[Todos os guias](../../../../README.md#get-started) · [README do componente LiveTrial](../../../../apps/timetrials-desktop/README.md)

O LiveTrial é um programa para Windows que acompanha as tuas tentativas de Contrarrelógio através de uma placa de
captura, ou lê vídeos gravados, reconhece cada tentativa (tempo total e tempos por volta, personagem e configuração
do kart, fantasma) e guarda-a no teu PC com um clip. Depois de iniciares sessão uma vez, pode enviar os resultados
para o site da tua comunidade. Os resultados que ainda não podem ser enviados ficam à espera no PC.

## Sem site da comunidade

O LiveTrial também funciona sozinho. A captura, a análise de vídeo, o **Histórico de tentativas**, os clips e as
correções funcionam localmente. As tentativas gravadas sem conta ficam apenas neste PC até as enviares com
**Enviar como <conta>**. Os separadores **Os meus recordes**, **Posição** e **Configuração** precisam de uma
comunidade com sessão iniciada.

## Requisitos

- Windows em x86-64 (testado no Windows 11). Cerca de 1 GB para o programa, mais espaço para as tuas gravações.
- Para a captura em direto: uma placa de captura que o Windows mostre como dispositivo de vídeo, com o respetivo
  controlador, e o **FFmpeg** (gratuito, não incluído por causa da licença; vê o passo 4 abaixo). Para ficheiros de
  vídeo: não precisas de placa de captura nem de FFmpeg.
- Para enviar resultados: o endereço do site da tua comunidade e uma conta nele (vê [Jogadores](PLAYERS.md)).
  No mesmo computador que uma instalação de teste local, `http://127.0.0.1:<port>` funciona; caso contrário, usa o
  endereço HTTPS de confiança.

## Instalar

1. Na página [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) do projeto (os pacotes
   estão anexados a cada release), transfere `desktop-client-….zip` e `SHA256SUMS.txt`. Com um clone, também
   podes compilar tu próprio o mesmo pacote: [Client builds](../../../CLIENT_BUILDS.md#livetrial-windows). Verifica-o no PowerShell:
   `Get-FileHash '.\desktop-client-<version>.zip' -Algorithm SHA256` e compara o valor completo.
2. Extrai o ZIP **completo** para uma pasta tua, por exemplo dentro de Documentos. Mantém a estrutura de pastas; o
   pacote traz o seu próprio ambiente Python, motor de reconhecimento e recursos do jogo.
3. Faz duplo clique em `LiveTrial.exe`. O painel abre-se na sua própria janela (Edge, senão Chrome, senão o teu
   navegador predefinido). A análise de vídeos funciona de imediato.
4. Para a captura em direto, instala o FFmpeg uma vez. A forma mais fácil: abre o PowerShell e executa `winget install Gyan.FFmpeg`,
   depois sai do LiveTrial e volta a abri-lo para que veja o novo PATH. Sem winget, transfere uma compilação para
   Windows (por exemplo o zip da release de gyan.dev, com ligação em [ffmpeg.org/download.html](https://ffmpeg.org/download.html)),
   descomprime-o e copia `bin\ffmpeg.exe` para `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`. Se o FFmpeg
   faltar, **Iniciar captura** indica-o e mostra estes passos.

## Ligar-te à tua comunidade

1. Abre **Definições**. Introduz o endereço da tua comunidade em **Endereço do site da comunidade** (por exemplo
   `https://www.example.org`) e escolhe **Guardar servidor**. O LiveTrial reinicia-se sozinho; deixa-o aberto.
2. Depois do reinício, verifica se as Definições mostram exatamente o teu endereço e inicia sessão no menu da conta
   (código por e-mail, ligação por e-mail ou aprovação no site).
3. Se o reinício automático falhar, escolhe **Sair do LiveTrial** na aplicação, espera até que tenha fechado e abre
   `LiveTrial.exe` de novo. Fechar só a janela não chega: o LiveTrial pode continuar a funcionar em segundo plano.

As contas e as tentativas em espera são guardadas separadamente por servidor: mudar de servidor nunca envia
tentativas antigas para a nova comunidade. Nunca introduzas no LiveTrial o endereço da caixa de correio local nem o
endereço interno de um servidor.

## Ligar-te mais tarde

Podes gravar primeiro e juntar-te a uma comunidade mais tarde. O que acontece às tentativas que já estão neste PC:

- **Escolhe a comunidade antes de gravares.** As tentativas são guardadas por servidor. As tentativas gravadas antes
  de guardares um endereço de comunidade, ou enquanto estava definida outra comunidade, ficam com esse servidor e
  nunca são oferecidas à nova. Para trazeres uma dessas gravações, volta a usar **Analisar um vídeo** com o respetivo
  ficheiro de vídeo depois de te ligares.
- **As tentativas gravadas sem conta** não são enviadas quando inicias sessão mais tarde. Escolhe **Enviar como <conta>**
  numa tentativa (no **Histórico de tentativas** ou na linha que aparece depois da corrida), ou na linha **Sem conta**
  da lista de espera (o contador no topo), para as dares todas à conta com sessão iniciada. Vão para o Jogador
  dessa conta; nada é atribuído sem esta escolha.
- **As tentativas gravadas com sessão iniciada** saem sempre com essa mesma conta. **Enviar agora** envia todas as
  tentativas em espera, cada uma com a sua própria conta; uma tentativa cuja conta terminou sessão fica à espera até
  essa conta voltar a iniciar sessão.
- **Cada tentativa é guardada uma só vez.** Cada tentativa tem o seu próprio ID de submissão, e o site não aceita uma
  segunda cópia da mesma tentativa.
- **Os clips e os vídeos ficam neste PC.** Só o resultado (tempos, pista, configuração) vai para o site; um
  carregamento no YouTube é um passo à parte e opcional.

## Usar o LiveTrial

- **Iniciar captura**: escolhe a placa de captura. O LiveTrial mostra primeiro uma imagem fixa dela, para que possas
  verificar se é o dispositivo certo. O separador **Live** mostra depois a imagem e cada tentativa reconhecida.
- **Analisar um vídeo**: escolhe um ficheiro `.mp4`/`.mkv` (é copiado para
  `%LOCALAPPDATA%\MK8DX\LiveTrial\videos`) e o LiveTrial processa-o como uma captura.
- Depois de cada corrida, a linha **Última corrida** diz onde está a tentativa: no site, guardada e à espera de envio
  (**Enviar agora**), ou apenas neste PC (**Enviar como <conta>**).
- O **Histórico de tentativas** lista cada tentativa com o respetivo clip. Podes corrigir um reconhecimento; uma
  correção guarda uma nova versão e mantém a anterior.
- O envio automático está desativado por predefinição; ativa-o nas Definições. Uma tentativa é sempre guardada
  primeiro localmente.

Define **Idioma da tua Switch** nas Definições quando o idioma da consola for diferente do idioma do painel.

O painel só pode ser controlado a partir deste computador: na janela do LiveTrial ou na página do painel aberta neste
PC. Se o motor for iniciado com `--lan` (vê o
[README do componente LiveTrial](../../../../apps/timetrials-desktop/README.md)), telemóveis e tablets na rede podem
ver a vista em direto e as corridas, mas não podem alterar nada.

## Nomes de clip legíveis

Dentro do LiveTrial, um clip mantém o seu nome interno. Cada clip terminado aparece também numa única pasta,
`Documentos\MK8DX\LiveTrial-clips` (no disco `Documents\MK8DX\LiveTrial-clips`), com um nome legível:

```
2026-11-16 10h25m  Mario Kart Stadium  150cc  1m46s784.mp4
```

- Data e hora em que o clip começou (o relógio deste PC), pista, classe (50cc, 100cc, 150cc, 200cc ou Mirror) e o
  tempo, com dois espaços entre os campos. Um clip gravado com o botão de gravar chama-se `Manual`, uma repetição de
  fantasma `Ghost <pista>`. Uma pista ou tempo que o LiveTrial não reconheceu é omitido (`Unknown track`), nunca
  adivinhado. Se um nome já existir, é acrescentado ` (2)`.
- A pista aparece no idioma do LiveTrial. Os nomes usam apenas letras, algarismos, espaços e `-`: os apóstrofos e
  outros sinais desaparecem e os acentos tornam-se letras simples (Yoshi's Circuit passa a Yoshis Circuit). Em russo,
  japonês, coreano ou chinês a pista aparece em inglês, para que os nomes de ficheiro fiquem em letras simples.
- Na mesma unidade que os dados do LiveTrial, a entrada é uma ligação física (hard link) e não ocupa espaço extra;
  noutra unidade é uma cópia. Quando a limpeza de armazenamento do LiveTrial remove um clip, a cópia legível também
  desaparece; um clip afixado mantém a sua cópia.
- O **Histórico de tentativas** mostra o nome por baixo do clip, com **Open folder**. Desliga as cópias ou escolhe
  outra pasta em **Cópia legível dos clips** nas **Definições**.

A cópia é feita em segundo plano quando o clip está completo. Se falhar (por exemplo, a pasta não está acessível), o
próprio clip não é afetado.

## Problemas

- Site errado, ou o início de sessão abre o site errado: sai do LiveTrial com **Sair do LiveTrial**, volta a abri-lo
  e verifica o endereço nas Definições. Pode haver outra conta do Windows no mesmo PC com o LiveTrial ainda a funcionar.
- Nenhum dispositivo de captura listado: verifica a ligação USB e o controlador, espera alguns segundos e tenta de novo.
- Erros de reconhecimento: corrige a tentativa no Histórico de tentativas antes de a enviares. O reconhecimento nunca
  substitui a verificação do teu próprio resultado.

O LiveTrial é só para Windows; não existe versão para macOS nem Linux. Para o compilares tu próprio, vê
[Client builds](../../../CLIENT_BUILDS.md).
