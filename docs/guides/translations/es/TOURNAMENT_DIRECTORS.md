# Tournament Directors: dirigir una noche de torneo

*Esta es una traducción automática de la [guía en inglés](../../TOURNAMENT_DIRECTORS.md); la versión en inglés es la que manda. Las correcciones son bienvenidas mediante el formulario de incidencia «Translation correction».*

[Todas las guías](../../../../README.md#get-started) · [Referencia de Tournament Tools](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

Un Director del torneo dirige una noche de torneo en la web de la comunidad: participantes, consolas, grupos,
puntuaciones, finales y el informe publicado. Las **Tournament Tools** de Windows pueden leer los resultados de las
carreras desde grabaciones o desde la captura en directo, así que no tienes que escribir cada posición a mano. Son
opcionales: las puntuaciones también se pueden introducir a mano o importar desde Excel/CSV.

**Sin web:** las Tournament Tools de Windows de la [sección 3](#3-las-tournament-tools-de-windows) (Processor,
Analysis y Live) funcionan por sí solas. Escriben archivos Excel, CSV y JSON en tu PC; Connect es opcional.

El reconocimiento nunca hace oficial un resultado. Tú revisas cada carrera antes de que cuente y tú decides la publicación.

## 1. Conseguir derechos de Director en la web de tu comunidad

1. Inicia sesión en la web (consulta [Jugadores](PLAYERS.md)).
2. En la página **Torneos** elige **Solicitar organizar**. Un administrador aprueba o rechaza la solicitud.
   Los administradores, y los Directores una vez aprobados, no ven ese botón: ven **Crear torneo nuevo** en
   la misma página (en la barra **Dirección de carrera**) y empiezan la noche desde ahí.
3. Para enviar carreras reconocidas desde las herramientas de Windows a la web, un administrador también da a tu
   Jugador con la sesión iniciada acceso en **Administración → Torneos → Directores**. Esto da acceso a Torneos,
   no a la administración general.

## 2. Dirigir la noche en la web

Abre el torneo desde **Torneos** (los administradores también llegan a él en **Administración → Torneos**).
La noche es una secuencia de pasos; la página muestra dónde estás:

| Paso | Qué haces |
| --- | --- |
| 0 | Elegir al Director |
| 1 | Iniciar el torneo |
| 2 | Seleccionar a los participantes, marcar quién está presente y qué Switches trae cada uno (las casillas **NS1**/**NS2** junto a cada nombre) |
| 3-4 | Crear y exportar la distribución de la clasificatoria (grupos y asientos) |
| 5 | Introducir las puntuaciones de la clasificatoria: a mano, desde un archivo Excel/CSV o desde **Resultados entrantes** |
| 6 | Exportar los resultados de la clasificatoria |
| 7-8 | Revisar y exportar los grupos finales |
| 9 | Introducir las puntuaciones de los grupos finales; una importación funciona por grupo y rechaza un grupo mientras un nombre siga sin emparejar |
| 10 | Finalizar y compartir: tabla final, informe y la exportación para WordPress |

El paso 2 solo continúa cuando hay suficientes Switches: cada Switch da sitio a dos Jugadores, así que la noche
necesita al menos la mitad de los participantes Presentes, redondeada hacia arriba, en Switches marcadas (9 Jugadores
Presentes necesitan 5). El cuadro de preparación debajo de la lista muestra cuántas faltan; marca las Switches que
trae la gente, o pasa participantes a Lista de espera o Ausente.

Para las carreras que vienen de las Tournament Tools: abre **Resultados entrantes** del grupo, empareja cada nombre
reconocido con el Jugador correcto, comprueba el circuito y las posiciones finales, y elige **Confirmar**. Una tabla
provisional en directo no es un resultado oficial. También puedes importar un archivo de resultados directamente con
**Alternativa sin conexión: importa un archivo de resultados guardado de Live / Processor** dentro de un grupo, o con
**Administración → Torneos → Importar resultados de carrera canónicos**.

La publicación y el rating de la comunidad son decisiones aparte en el último paso.

## 3. Las Tournament Tools de Windows

### Requisitos

- Windows en x86-64 (probado en Windows 11) y varios GB de espacio libre. El ZIP ocupa unos 160 MB y alrededor de 1 GB descomprimido; el
  instalador necesita internet una vez, para descargar Python 3.12 y paquetes públicos (más con GPU/CUDA); los modelos de detección y
  de OCR de alfabeto latino están incluidos, y la primera ejecución de OCR en inglés descarga una vez un modelo más (english_g2.pth,
  unos 15 MB). Después, el procesamiento funciona sin conexión. Una tarjeta
  NVIDIA solo acelera el paso de OCR; el primer escaneo de una grabación siempre se ejecuta en la CPU (consulta
  [qué pasos usan la tarjeta gráfica](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- Para la captura en directo: una capturadora con un driver de Windows (DirectShow) que funcione. Para grabaciones: nada más.
- Opcional, para enviar resultados: la dirección de la web y el acceso de operador de Torneos (paso 1).

### Instalar

1. En la página [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) del proyecto (los
   paquetes van adjuntos a cada release), descarga `tournament-tools-….zip` y `SHA256SUMS.txt`. Con un clon
   también puedes compilarlo tú mismo ([Compilar las herramientas por tu cuenta](#compilar-las-herramientas-por-tu-cuenta)). En PowerShell:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, y compara el valor completo.
2. Extrae el ZIP completo en una carpeta con permiso de escritura (no `Program Files`). Deja `runtime-assets\` junto a
   los lanzadores.
3. Haz doble clic en `Install-MK8DX-TournamentTools.cmd` y espera a ver `SUCCESS`. Elige por sí solo PyTorch con NVIDIA
   CUDA o con CPU para este ordenador. Si falla, lee `install.log` en la carpeta del paquete.

El instalador crea estos lanzadores:

| Lanzador | Uso |
| --- | --- |
| `TournamentProcessor.cmd` | Arrastra encima una grabación `.mp4` o `.mkv`. Crea una carpeta de sesión junto al vídeo (`<name>_TournamentSession\Output_Results\`) con Excel, CSV y `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | Una ventana para el mismo análisis de vídeo grabado con varios vídeos o una carpeta por torneo ([más abajo](#analizar-grabaciones-a-posteriori)). |
| `TournamentLive.cmd` | Captura en directo durante la noche, o reproducir un vídeo: **Añadir archivo de vídeo** (o añade un dispositivo de captura), **Iniciar todo**, revisa **Clasificación confirmada** y después **Abrir exportaciones**. Para entregar la sesión, consulta [Tournament Live a la web](#tournament-live-a-la-web). |
| `TournamentConnect.cmd` | Conexión opcional con la web (más abajo). |
| `TournamentLiveCli.cmd` | Diagnóstico: detección de dispositivos, reproducción y comandos de resultados. No sustituye a la ventana en directo. |

`TournamentTools.config.cmd` contiene las rutas locales y las preferencias de idioma. Consérvalo, junto con la carpeta
de sesiones `TournamentLive\` y tus carpetas de salida, cuando instales un paquete más reciente.

### Analizar grabaciones a posteriori

Usa Tournament Live cuando captures la noche mientras ocurre. Si la noche se jugó sin él y solo tienes
grabaciones, analízalas después con la ventana **Tournament Analysis**:

1. Haz doble clic en `TournamentAnalysis.cmd` en la carpeta del paquete.
2. **① Choose recordings** (elegir grabaciones): **Add videos...** (añadir vídeos) elige una o más grabaciones (`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`); **Add folder...** (añadir carpeta) añade una carpeta que contiene las grabaciones de un torneo.
3. **② Choose videos** (elegir vídeos): todo lo que has añadido está marcado; desmarca lo que no se deba analizar (**All**, **None**,
   **Clear**: todos, ninguno, vaciar).
4. **③ Run the analysis** (ejecutar el análisis): comprueba el **Session id** (ID de sesión; se rellena a partir del primer nombre y la fecha y se guarda
   con cada carrera) y la **Results folder** (carpeta de resultados; por defecto `<first name>_TournamentSession` junto a la primera
   grabación), y después elige **START ANALYSIS** (iniciar análisis). La ventana ejecuta el mismo procesamiento que `TournamentProcessor.cmd`;
   el registro de actividad muestra su salida en color, el semáforo de inicio se pone ámbar y **Cancel** (cancelar) lo detiene. Las grabaciones
   se enlazan en `Input_Videos\` de la carpeta de resultados, o se copian cuando están en otra unidad.
5. **🏁 Results** (resultados): cuando ponga **Finished** (terminado), elige **Open Latest Excel** (abrir el último Excel) u **Open Results Folder** (abrir la carpeta de resultados): `Output_Results\`
   contiene el libro de Excel, el CSV y `*_TournamentRaceResultsV1.json`. Revisa las carreras y después importa el JSON
   en la web como se describe más arriba.

Los textos siguen el idioma de Windows (inglés o neerlandés); `MK8DX_TOURNAMENT_LANGUAGE` en
`TournamentTools.config.cmd` lo cambia. Para mostrar otra imagen en el banner, pon en `MK8DX_ANALYSIS_BACKGROUND`
de `TournamentTools.config.cmd` la ruta de ese archivo. Desde un clon, `python -m tournament_processor.gui` abre la misma ventana cuando
Tournament Processor y sus recursos de reconocimiento están instalados; necesita PySide6 (el extra `gui` del processor) y,
si no lo tiene, o con `--classic-gui`, abre una ventana Tkinter más sencilla.

### Conectarte a la web (opcional)

En PowerShell, en la carpeta del paquete:

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

Usa `http://127.0.0.1:<port>` (o `http://localhost:<port>`) solo cuando la web funcione en el mismo ordenador con
Windows, como hacen A1 y A3: el HTTP sin cifrar solo se acepta para estas direcciones en este PC y para nada más;
cualquier otra dirección necesita su dirección HTTPS de confianza. Sin terminal (por ejemplo desde un script)
`sign-in` no pregunta: configura antes la dirección con `TournamentConnect.cmd server <address>`. Las subidas que
esperan a un servidor se quedan con ese servidor. Una carrera entregada llega a **Resultados entrantes**; nunca se
publica automáticamente.

### Tournament Live a la web

1. En Tournament Live elige **Conectar con Tournament Manager** (después **Cambiar Torneo**), termina el inicio de
   sesión en el navegador y elige la noche en **Choose Tournament** (elegir torneo). Esa elección es solo una sugerencia; puedes hacerla antes
   o después de la sesión.
2. Pon en marcha las señales (**Añadir archivo de vídeo** o una capturadora, y después **Iniciar todo**). Tournament Live
   puede añadir por sí solo una capturadora que recuerda, como fuente extra en el Grupo 1. Si además hay un vídeo en el
   Grupo 1, **Iniciar todo** se detiene con *Assign every feed to exactly one different group* (asigna cada señal a
   exactamente un grupo distinto): selecciona la fuente extra y elige **Quitar seleccionados**, o dale su propio grupo,
   y vuelve a iniciar.
3. En la web, abre la noche, ve al Paso 5 (Paso 9 para los grupos finales) y busca la sesión en **Grabaciones de Tournament Live disponibles**.
   Elige su grupo en **Vincular al grupo** y después **Vincular grabación revisada**. Las carreras esperan como evidencia
   pendiente hasta que las aceptes.

### Conectarte más tarde

Una noche procesada sin conexión está completa en tu PC: `Output_Results\` contiene el libro de Excel, el CSV
y `*_TournamentRaceResultsV1.json`. Tournament Live sin conexión también escribe su libro de Excel: cuando detienes
las señales, cuando termina el análisis o cuando cierras la ventana mientras las señales siguen activas (primero las
detiene). Los archivos se quedan en `Live_Output\exports` (**Abrir exportaciones**) después de cerrarlo. Si Live se
cierra a la fuerza antes de que se detengan las señales, falta ese libro final; las grabaciones se conservan y
Tournament Analysis o el Processor generan el mismo libro a partir de ellas. Después no se envía nada por sí solo;
llévalo a la web de una de estas formas:

- En el grupo de la web: **Alternativa sin conexión: importa un archivo de resultados guardado de Live / Processor**
  con el JSON, o la importación de Excel del grupo. Cada nombre reconocido debe emparejarse antes con un Jugador; una
  importación rechaza un grupo mientras un nombre siga sin emparejar.
- Un administrador: **Administración → Torneos → Importar resultados de carrera canónicos**. Las carreras importadas
  siguen siendo privadas hasta que se publican.
- Con TournamentConnect: `.\TournamentConnect.cmd sign-in`, y después
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`. Pregunta la noche, el grupo y el número de la
  primera carrera; las carreras llegan a **Resultados entrantes**. Si no se puede llegar a la web, el archivo se queda
  donde está; vuelve a enviarlo más tarde.
- En Tournament Live: elegir la noche con **Conectar con Tournament Manager** cuando una sesión ya ha terminado ofrece
  esa sesión terminada a la noche. Las subidas que fallaron mientras Live estaba conectado se conservan y se vuelven a
  enviar, automáticamente o con **Reintentar subida**, solo para la misma cuenta con la sesión iniciada. Una sesión
  ejecutada con **Trabajar sin conexión** no se conserva para subirla; usa una de las vías anteriores para su archivo.

Iniciar sesión añade dos cosas: la lista de noches a las que puedes entregar, y la señal en directo durante la noche
(`target`), que envía cada carrera al grupo elegido a medida que Tournament Live la reconoce. En cualquier caso, una
carrera solo cuenta después de que la confirmes en **Resultados entrantes**.

### Comprobar lo que se ha leído

El OCR puede leer mal un nombre, una posición o una puntuación acumulada. Compara cada carrera con la pantalla o la
grabación antes de confirmarla. Una limitación conocida: Tournament Live puede exportar un resultado de carrera
correcto con un total acumulado mal leído, y la revisión de la web no puede editar el nombre ni el total observados
(consulta [Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

Las herramientas leen el juego en sus 15 idiomas de consola. Tournament Live superó una prueba de aceptación física a
1× con el paquete v0.2.2: tres PC de origen reprodujeron vídeos de clasificatoria grabados en sus propias capturadoras
([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). Una reproducción de vídeo sin capturadora
no prueba la vía de captura.

## Compilar las herramientas por tu cuenta

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` desde un clon compila
el mismo paquete; consulta [Client builds](../../../CLIENT_BUILDS.md).
