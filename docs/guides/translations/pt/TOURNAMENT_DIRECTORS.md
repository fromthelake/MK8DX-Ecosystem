# Tournament Directors: dirigir uma noite de torneio

*Esta é uma tradução automática do [guia em inglês](../../TOURNAMENT_DIRECTORS.md); a versão inglesa é a que prevalece. As correções são bem-vindas através do formulário de issue «Translation correction».*

[Todos os guias](../../../../README.md#get-started) · [Referência das Tournament Tools](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

Um Diretor de Torneio dirige uma noite de torneio no site da comunidade: participantes, consolas, grupos,
pontuações, finais e o relatório publicado. As **Tournament Tools** para Windows conseguem ler os resultados das
corridas a partir de gravações ou da captura em direto, por isso não tens de escrever cada posição à mão. São
opcionais: as pontuações também podem ser introduzidas à mão ou importadas de Excel/CSV.

**Sem site:** as Tournament Tools para Windows da [secção 3](#3-as-tournament-tools-para-windows) (Processor,
Analysis e Live) funcionam sozinhas. Escrevem ficheiros Excel, CSV e JSON no teu PC; o Connect é opcional.

O reconhecimento nunca torna um resultado oficial. És tu que revês cada corrida antes de contar e que decides a publicação.

## 1. Obter direitos de Diretor no site da tua comunidade

1. Inicia sessão no site (vê [Jogadores](PLAYERS.md)).
2. Na página **Torneios** escolhe **Pedir para organizar**. Um administrador aprova ou recusa o pedido.
   Os administradores, e os Diretores depois de aprovados, não veem esse botão: veem **Criar novo torneio** na
   mesma página (na barra **Direção de corrida**) e começam a noite a partir daí.
3. Para enviar corridas reconhecidas das ferramentas do Windows para o site, um administrador também dá ao teu
   Jogador com sessão iniciada acesso em **Administração → Torneios → Diretores**. Isto dá acesso aos Torneios,
   não à administração geral.

## 2. Dirigir a noite no site

Abre o torneio a partir de **Torneios** (os administradores também lá chegam em **Administração → Torneios**).
A noite é uma sequência de passos; a página mostra onde estás:

| Passo | O que fazes |
| --- | --- |
| 0 | Escolher o Diretor |
| 1 | Iniciar o torneio |
| 2 | Selecionar os participantes, marcar quem está presente e que Switches cada um traz (as caixas **NS1**/**NS2** ao lado de cada nome) |
| 3-4 | Criar e exportar a distribuição da qualificação (grupos e lugares) |
| 5 | Introduzir as pontuações da qualificação: à mão, a partir de um ficheiro Excel/CSV ou a partir de **Resultados recebidos** |
| 6 | Exportar os resultados da qualificação |
| 7-8 | Verificar e exportar os grupos finais |
| 9 | Introduzir as pontuações dos grupos finais; uma importação funciona por grupo e recusa um grupo enquanto houver um nome por associar |
| 10 | Finalizar e partilhar: tabela final, relatório e a exportação para WordPress |

O passo 2 só avança quando há Switches suficientes: cada Switch dá lugar a dois Jogadores, por isso a noite precisa
de pelo menos metade dos participantes Presentes, arredondada para cima, em Switches marcadas (9 Jogadores Presentes
precisam de 5). A caixa de preparação por baixo da lista mostra quantas faltam; marca as Switches que as pessoas
trazem, ou passa participantes para Lista de espera ou Ausente.

Para corridas que vieram das Tournament Tools: abre **Resultados recebidos** do grupo, associa cada nome reconhecido
ao Jogador certo, verifica a pista e as posições finais e escolhe **Confirmar**. Uma tabela provisória em direto
não é um resultado oficial. Também podes importar um ficheiro de resultados diretamente com **Alternativa offline:
importar um ficheiro de resultados guardado do Live / Processor** dentro de um grupo, ou com
**Administração → Torneios → Importar resultados de corrida canónicos**.

A publicação e o rating da comunidade são decisões separadas no último passo.

## 3. As Tournament Tools para Windows

### Requisitos

- Windows em x86-64 (testado no Windows 11) e vários GB de espaço livre. O ZIP tem cerca de 450 MB e cerca de 1,3 GB depois de extraído; o
  instalador precisa de internet uma vez, para transferir o Python 3.12 e pacotes públicos (mais com GPU/CUDA); todos os modelos de OCR
  estão incluídos. Depois da instalação, o processamento funciona offline. Uma placa
  NVIDIA só acelera o passo de OCR; a primeira leitura de uma gravação corre sempre no CPU (vê
  [que passos usam a placa gráfica](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- Para a captura em direto: uma placa de captura com um controlador do Windows (DirectShow) a funcionar. Para gravações: nada mais.
- Opcional, para enviar resultados: o endereço do site e o acesso de operador de Torneios (passo 1).

### Instalar

1. Na página [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) do projeto (os pacotes
   estão anexados a cada release), transfere `tournament-tools-….zip` e `SHA256SUMS.txt`. Com um clone, também
   podes compilá-lo tu próprio ([Compilar as ferramentas tu próprio](#compilar-as-ferramentas-tu-próprio)). No PowerShell:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, e compara o valor completo.
2. Extrai o ZIP completo para uma pasta com permissão de escrita (não `Program Files`). Mantém `runtime-assets\` ao
   lado dos iniciadores.
3. Faz duplo clique em `Install-MK8DX-TournamentTools.cmd` e espera por `SUCCESS`. Escolhe sozinho o PyTorch com
   NVIDIA CUDA ou com CPU para este computador. Se falhar, lê `install.log` na pasta do pacote.

O instalador cria estes iniciadores:

| Iniciador | Utilização |
| --- | --- |
| `TournamentProcessor.cmd` | Arrasta para cima dele uma gravação `.mp4` ou `.mkv`. Cria uma pasta de sessão ao lado do vídeo (`<name>_TournamentSession\Output_Results\`) com Excel, CSV e `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | Uma janela para a mesma análise de vídeos gravados, com vários vídeos ou uma pasta por torneio ([abaixo](#analisar-as-gravações-depois)). |
| `TournamentLive.cmd` | Captura em direto durante a noite, ou reproduzir um vídeo: **Adicionar ficheiro de vídeo** (ou adiciona um dispositivo de captura), **Iniciar tudo**, verifica **Classificação confirmada** e depois **Abrir exportações**. Para entregar a sessão, vê [Tournament Live para o site](#tournament-live-para-o-site). |
| `TournamentConnect.cmd` | Ligação opcional ao site (abaixo). |
| `TournamentLiveCli.cmd` | Diagnóstico: deteção de dispositivos, reprodução e comandos de resultados. Não substitui a janela em direto. |

`TournamentTools.config.cmd` guarda os caminhos locais e as preferências de idioma. Mantém-no, assim como a pasta de
sessões `TournamentLive\` e as tuas pastas de saída, quando instalares um pacote mais recente.

**Nomes de jogadores noutras escritas.** O Tournament Live e o Tournament Analysis leem os nomes dos jogadores
não só no alfabeto latino, mas também em cirílico, japonês, coreano e chinês. Para isso são precisos cinco
leitores de texto adicionais, cerca de 1 GB de memória no total (na placa gráfica, se houver). Se ninguém na tua
comunidade usar essas escritas, desliga-o para poupar essa memória: desmarca **Ler nomes de jogadores em
escritas não latinas** em **Reconhecimento** no Tournament Live ou em **Executar a análise** na janela
Tournament Analysis, ou define `MK8DX_NAME_SCRIPTS=off` em `TournamentTools.config.cmd` (também se aplica ao
`TournamentProcessor.cmd`). Os nomes latinos são lidos da mesma forma em ambos os casos. Por predefinição está
ligado.

### Analisar as gravações depois

Usa o Tournament Live quando capturas a noite enquanto decorre. Quando a noite decorreu sem ele e só tens
gravações, analisa-as depois com a janela **Tournament Analysis**:

1. Faz duplo clique em `TournamentAnalysis.cmd` na pasta do pacote.
2. **① Escolher gravações**: **Adicionar vídeos...** escolhe uma ou mais gravações (`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`); **Adicionar pasta...** adiciona uma pasta que contém as gravações de um torneio.
3. **② Escolher vídeos**: tudo o que adicionaste fica marcado; desmarca o que não deve ser analisado (**Todos**, **Nenhum**,
   **Limpar**: todos, nenhum, limpar).
4. **③ Executar a análise**: verifica o **ID de sessão** (preenchido a partir do primeiro nome e da data e guardado
   com cada corrida) e a **Pasta de resultados** (por predefinição `<first name>_TournamentSession` ao lado da primeira
   gravação) e depois escolhe **INICIAR ANÁLISE**. A janela executa o mesmo processamento que `TournamentProcessor.cmd`;
   o registo de atividade mostra a saída a cores, a luz de início fica âmbar e **Cancelar** termina-o. As gravações
   são ligadas em `Input_Videos\` da pasta de resultados, ou copiadas quando estão noutra unidade.
5. **🏁 Resultados**: quando aparecer **Concluído**, escolhe **Abrir o Excel mais recente** ou **Abrir pasta de resultados**: `Output_Results\`
   contém o livro de Excel, o CSV e `*_TournamentRaceResultsV1.json`. Verifica as corridas e depois importa o JSON
   no site como descrito acima.

Os textos seguem o idioma do Windows (inglês ou neerlandês); `MK8DX_TOURNAMENT_LANGUAGE` em
`TournamentTools.config.cmd` altera-o. Para mostrar outra imagem no banner, define `MK8DX_ANALYSIS_BACKGROUND`
em `TournamentTools.config.cmd` com esse ficheiro. A partir de um clone, `python -m tournament_processor.gui` abre a mesma janela quando
o Tournament Processor e os seus recursos de reconhecimento estão instalados; precisa do PySide6 (o extra `gui` do processor) e,
caso contrário, ou com `--classic-gui`, abre uma janela Tkinter mais simples.

### Ligar ao site (opcional)

No PowerShell, na pasta do pacote:

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

Usa `http://127.0.0.1:<port>` (ou `http://localhost:<port>`) só quando o site corre no mesmo computador com
Windows, como acontece com A1 e A3: o HTTP simples é aceite para estes endereços neste PC e para mais nada; qualquer
outro endereço precisa do seu endereço HTTPS de confiança. Sem terminal (por exemplo a partir de um script)
`sign-in` não pergunta: define primeiro o endereço com `TournamentConnect.cmd server <address>`. Os carregamentos
à espera de um servidor ficam com esse servidor. Uma corrida entregue chega a **Resultados recebidos**; nunca é
publicada automaticamente.

### Tournament Live para o site

1. No Tournament Live escolhe **Ligar ao Tournament Manager** (mais tarde **Mudar de Torneio**), conclui o início
   de sessão no navegador e escolhe a noite em **Escolher Torneio**. Essa escolha é só uma sugestão; podes fazê-la antes
   ou depois da sessão.
2. Põe as transmissões a correr (**Adicionar ficheiro de vídeo** ou uma placa de captura, depois **Iniciar tudo**). O
   Tournament Live pode adicionar sozinho uma placa de captura de que se lembra, como fonte extra no Grupo 1. Se houver
   também um vídeo no Grupo 1, **Iniciar tudo** para com *Atribui cada transmissão a exatamente um grupo diferente do passo atual antes de premires START*: seleciona a fonte extra e escolhe **Remover selecionados**, ou dá-lhe
   o seu próprio grupo, e inicia de novo.
3. No site, abre a noite, vai ao Passo 5 (Passo 9 para os grupos finais) e procura a sessão em **Gravações do Tournament Live disponíveis**.
   Escolhe o grupo dela em **Associar ao grupo** e depois **Associar gravação revista**. As corridas ficam à espera como
   provas pendentes até as aceitares.

### Ligar mais tarde

Uma noite processada sem ligação fica completa no teu PC: `Output_Results\` contém o livro de Excel, o CSV
e `*_TournamentRaceResultsV1.json`. O Tournament Live sem ligação também escreve o seu livro de Excel: quando paras
as transmissões, quando a análise termina ou quando fechas a janela com transmissões ainda a correr (primeiro para-as).
Os ficheiros ficam em `Live_Output\exports` (**Abrir exportações**) depois de o fechares. Se o Live for terminado à
força antes de as transmissões pararem, esse livro final falta; as gravações ficam guardadas e o Tournament Analysis
ou o Processor criam o mesmo livro a partir delas. Depois disso nada é enviado sozinho; leva-o para o site de uma
destas formas:

- No grupo do site: **Alternativa offline: importar um ficheiro de resultados guardado do Live / Processor** com o
  JSON, ou a importação de Excel do grupo. Cada nome reconhecido tem primeiro de ser associado a um Jogador; uma
  importação recusa um grupo enquanto houver um nome por associar.
- Um administrador: **Administração → Torneios → Importar resultados de corrida canónicos**. As corridas importadas
  ficam privadas até serem publicadas.
- Com o TournamentConnect: `.\TournamentConnect.cmd sign-in`, depois
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`. Pergunta a noite, o grupo e o número da
  primeira corrida; as corridas chegam a **Resultados recebidos**. Se o site não estiver acessível, o ficheiro fica
  onde está; envia-o de novo mais tarde.
- No Tournament Live: escolher a noite com **Ligar ao Tournament Manager** depois de uma sessão ter terminado oferece
  essa sessão terminada à noite. Os carregamentos que falharam enquanto o Live estava ligado são guardados e enviados
  de novo, automaticamente ou com **Tentar enviar novamente**, só para a mesma conta com sessão iniciada. Uma sessão
  executada com **Trabalhar offline** não é guardada para carregamento; usa uma das vias acima para o seu ficheiro.

Iniciar sessão acrescenta duas coisas: a lista de noites para as quais podes entregar, e a transmissão em direto
durante a noite (`target`), que envia cada corrida para o grupo escolhido à medida que o Tournament Live a reconhece.
Em qualquer caso, uma corrida só conta depois de a confirmares em **Resultados recebidos**.

### Verificar o que foi lido

O OCR pode ler mal um nome, uma posição ou uma pontuação acumulada. Compara cada corrida com o ecrã ou a gravação
antes de a confirmares. Uma limitação conhecida: o Tournament Live pode exportar um resultado de corrida correto com
um total acumulado mal lido, e a revisão no site não consegue editar o nome nem o total observados (vê
[Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

As ferramentas leem o jogo nos seus 15 idiomas de consola. O Tournament Live passou num teste de aceitação físico a
1× com o pacote v0.2.2: três PC de origem reproduziram vídeos de qualificação gravados nas suas próprias placas de
captura ([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). Uma reprodução de vídeo sem placa
de captura não testa a via de captura.

## Compilar as ferramentas tu próprio

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` a partir de um clone compila
o mesmo pacote; vê [Client builds](../../../CLIENT_BUILDS.md).
