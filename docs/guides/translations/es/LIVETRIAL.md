# LiveTrial: grabar Contrarreloj en Windows

*Esta es una traducción automática de la [guía en inglés](../../LIVETRIAL.md); la versión en inglés es la que manda. Las correcciones son bienvenidas mediante el formulario de incidencia «Translation correction».*

[Todas las guías](../../../../README.md#get-started) · [README del componente LiveTrial](../../../../apps/timetrials-desktop/README.md)

LiveTrial es un programa de Windows que sigue tus Contrarreloj a través de una capturadora, o lee vídeos grabados,
reconoce cada carrera (tiempo total y tiempos por vuelta, personaje y combinación del kart, fantasma) y la guarda
en tu PC con un clip. Después de iniciar sesión una vez, puede enviar los resultados a la web de tu comunidad. Los
resultados que todavía no se pueden enviar esperan en el PC.

## Sin web de comunidad

LiveTrial también funciona por sí solo. La captura, el análisis de vídeo, el **Historial de carreras**, los clips y
las correcciones funcionan en local. Las carreras grabadas sin cuenta se quedan solo en este PC hasta que las envíes
con **Enviar como <cuenta>**. Las pestañas **Mis récords**, **Puesto** y **Configuración** necesitan una comunidad
con la sesión iniciada.

## Requisitos

- Windows en x86-64 (probado en Windows 11). Alrededor de 1 GB para el programa, más espacio para tus grabaciones.
- Para la captura en directo: una capturadora que Windows muestre como dispositivo de vídeo, con su driver, y
  **FFmpeg** (gratuito, no incluido por su licencia; consulta el paso 4 más abajo). Para archivos de vídeo: no hace
  falta capturadora ni FFmpeg.
- Para enviar resultados: la dirección de la web de tu comunidad y una cuenta en ella (consulta
  [Jugadores](PLAYERS.md)). En el mismo ordenador que una instalación local de prueba funciona
  `http://127.0.0.1:<port>`; en los demás casos usa la dirección HTTPS de confianza.

## Instalar

1. En la página [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) del proyecto (los
   paquetes van adjuntos a cada release), descarga `desktop-client-….zip` y `SHA256SUMS.txt`. Con un clon también
   puedes compilar tú mismo el mismo paquete: [Client builds](../../../CLIENT_BUILDS.md#livetrial-windows). Compruébalo en PowerShell:
   `Get-FileHash '.\desktop-client-<version>.zip' -Algorithm SHA256` y compara el valor completo.
2. Extrae el ZIP **completo** en una carpeta tuya, por ejemplo dentro de Documentos. Conserva su estructura de
   carpetas; el paquete trae su propio entorno de Python, motor de reconocimiento y recursos del juego.
3. Haz doble clic en `LiveTrial.exe`. El panel se abre en su propia ventana (Edge, si no Chrome, si no tu navegador
   predeterminado). El análisis de vídeos funciona desde el primer momento.
4. Para la captura en directo, instala FFmpeg una vez. Lo más fácil: abre PowerShell y ejecuta `winget install Gyan.FFmpeg`,
   después cierra LiveTrial y vuelve a abrirlo para que vea el nuevo PATH. Sin winget, descarga una compilación para
   Windows (por ejemplo el zip de la release de gyan.dev, enlazado desde [ffmpeg.org/download.html](https://ffmpeg.org/download.html)),
   descomprímelo y copia `bin\ffmpeg.exe` en `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`. Si falta FFmpeg,
   **Iniciar captura** lo indica y muestra estos pasos.

## Conectarte a tu comunidad

1. Abre **Ajustes**. Introduce la dirección de tu comunidad en **Dirección del sitio web de la comunidad** (por
   ejemplo `https://www.example.org`) y elige **Guardar servidor**. LiveTrial se reinicia solo; déjalo abierto.
2. Después del reinicio, comprueba que Ajustes muestra exactamente tu dirección y luego inicia sesión desde el menú
   de cuenta (código por correo, enlace por correo o aprobación en la web).
3. Si el reinicio automático falla, elige **Salir de LiveTrial** en la app, espera a que se haya cerrado y vuelve a
   abrir `LiveTrial.exe`. Cerrar solo la ventana no basta: LiveTrial puede seguir funcionando en segundo plano.

Las cuentas y las carreras en espera se guardan por separado para cada servidor: cambiar de servidor nunca envía
carreras antiguas a la nueva comunidad. No introduzcas nunca en LiveTrial la dirección del buzón de correo local ni
la dirección interna de un servidor.

## Conectarte más tarde

Puedes grabar primero y unirte a una comunidad más tarde. Lo que pasa con las carreras que ya están en este PC:

- **Elige la comunidad antes de grabar.** Las carreras se guardan por servidor. Las carreras grabadas antes de
  guardar una dirección de comunidad, o mientras había otra comunidad configurada, se quedan con ese servidor y nunca
  se ofrecen a la nueva. Para traer una de esas grabaciones, vuelve a usar **Analizar un vídeo** con su archivo de
  vídeo después de conectarte.
- **Las carreras grabadas sin cuenta** no se envían cuando inicias sesión más tarde. Elige **Enviar como <cuenta>**
  en una carrera (en **Historial de carreras** o en la línea que aparece tras la carrera), o en la línea **Sin cuenta**
  de la lista de espera (el contador de arriba), para dárselas todas a la cuenta con la sesión iniciada. Van al
  Jugador de esa cuenta; nada se asigna sin esta elección.
- **Las carreras grabadas con la sesión iniciada** siempre salen con esa misma cuenta. **Enviar ahora** envía todas
  las carreras en espera, cada una con su propia cuenta; una carrera cuya cuenta ha cerrado sesión espera hasta que
  esa cuenta vuelva a iniciarla.
- **Cada carrera se guarda una sola vez.** Cada carrera lleva su propio ID de envío, y la web no acepta una segunda
  copia de la misma carrera.
- **Los clips y los vídeos se quedan en este PC.** Solo el resultado (tiempos, circuito, combinación) va a la web;
  subirlo a YouTube es un paso aparte y opcional.

## Usarlo

- **Iniciar captura**: elige la capturadora. LiveTrial muestra primero una imagen fija de ella, para que compruebes
  que es el dispositivo correcto. La pestaña **En directo** muestra después la imagen y cada carrera reconocida.
- **Analizar un vídeo**: elige un archivo `.mp4`/`.mkv` (se copia en
  `%LOCALAPPDATA%\MK8DX\LiveTrial\videos`) y LiveTrial lo procesa como una captura.
- Después de cada carrera, la línea **Última carrera** dice dónde está la carrera: en la web, guardada y esperando a
  enviarse (**Enviar ahora**), o solo en este PC (**Enviar como <cuenta>**).
- **Historial de carreras** muestra cada carrera con su clip. Puedes corregir un reconocimiento; una corrección
  guarda una versión nueva y conserva la anterior.
- El envío automático está desactivado por defecto; actívalo en Ajustes. Una carrera siempre se guarda primero en
  local.

Configura **Idioma de tu Switch** en Ajustes cuando el idioma de la consola sea distinto del idioma del panel.

El panel solo se puede controlar desde este ordenador: en la ventana de LiveTrial o en la página del panel abierta en
este PC. Si el motor se inicia con `--lan` (consulta el
[README del componente LiveTrial](../../../../apps/timetrials-desktop/README.md)), los teléfonos y tabletas de la red
pueden ver la vista en directo y las carreras, pero no pueden cambiar nada.

## Nombres de clip legibles

Dentro de LiveTrial, un clip conserva su nombre interno. Cada clip terminado aparece también en una carpeta,
`Documentos\MK8DX\LiveTrial-clips` (en el disco `Documents\MK8DX\LiveTrial-clips`), con un nombre legible:

```
2026-11-16 10h25m  Mario Kart Stadium  150cc  1m46s784.mp4
```

- Fecha y hora en que empezó el clip (el reloj de este PC), circuito, categoría (50cc, 100cc, 150cc, 200cc o
  Mirror) y el tiempo, con dos espacios entre los campos. Un clip grabado con el botón de grabar se llama `Manual`,
  una repetición de fantasma `Ghost <circuito>`. Un circuito o tiempo que LiveTrial no reconoció se omite
  (`Unknown track`), nunca se adivina. Si un nombre ya existe, se añade ` (2)`.
- El circuito aparece en el idioma de LiveTrial. Los nombres solo usan letras, cifras, espacios y `-`: los
  apóstrofos y otros signos desaparecen y los acentos se convierten en letras simples (Yoshi's Circuit pasa a ser
  Yoshis Circuit). En ruso, japonés, coreano o chino el circuito aparece en inglés, para que los nombres de archivo
  sigan siendo letras simples.
- En la misma unidad que los datos de LiveTrial, la entrada es un enlace físico (hard link) y no ocupa espacio
  adicional; en otra unidad es una copia. Cuando la limpieza de almacenamiento de LiveTrial elimina un clip, su
  copia legible también desaparece; un clip fijado conserva su copia.
- El **Historial de carreras** muestra el nombre bajo el clip, con **Open folder**. Desactiva las copias o elige otra
  carpeta en **Copia legible de los clips** en **Configuración**.

La copia se hace en segundo plano cuando el clip está completo. Si falla (por ejemplo, la carpeta no está
accesible), el clip en sí no se ve afectado.

## Problemas

- Web equivocada, o el inicio de sesión abre el sitio equivocado: cierra LiveTrial con **Salir de LiveTrial**,
  vuelve a abrirlo y comprueba la dirección en Ajustes. Puede que otra cuenta de Windows del mismo PC aún tenga
  LiveTrial en marcha.
- No aparece ningún dispositivo de captura: comprueba la conexión USB y el driver, espera unos segundos y vuelve a
  intentarlo.
- Errores de reconocimiento: corrige la carrera en Historial de carreras antes de enviarla. El reconocimiento nunca
  sustituye a comprobar tu propio resultado.

LiveTrial es solo para Windows; no hay versión para macOS ni Linux. Para compilarlo tú mismo, consulta
[Client builds](../../../CLIENT_BUILDS.md).
