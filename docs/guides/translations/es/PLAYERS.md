# Jugadores: la web y la app de Android

*Esta es una traducción automática de la [guía en inglés](../../PLAYERS.md); la versión en inglés es la que manda. Las correcciones son bienvenidas mediante el formulario de incidencia «Translation correction».*

[Todas las guías](../../../../README.md#get-started)

Necesitas la dirección de la web MK8DX de tu comunidad, por ejemplo `https://www.example.org`. Cada comunidad
tiene su propia instalación con sus propias cuentas y resultados; pide la dirección a quienes llevan la tuya, y
también ayuda con tu cuenta. Para usar la web no tienes que instalar nada.

## La web

### Iniciar sesión

1. Abre la dirección de tu comunidad y elige el icono de cuenta (arriba a la derecha) y después **Iniciar sesión**.
2. Introduce tu dirección de correo electrónico y elige **Envíame un enlace por correo**. Abre el correo y sigue el enlace. No hay
   contraseña. El enlace funciona una vez y caduca; pide uno nuevo si no funciona.
3. La primera vez, el enlace abre directamente una configuración de tres pasos. El paso 1, **¿Ya estás en este sitio web?**,
   pregunta si tus tiempos de Contrarreloj ya están en la web y si participaste en un torneo que aparezca
   en ella. Si es así, el paso 2 te deja encontrar el Jugador que eres tú y pedir que se vincule a tu cuenta; un
   administrador o el Director del torneo de esa noche revisa esa reclamación antes de vincularla, y nada se
   vincula solo por el nombre. Si no, el paso 2 crea tu Jugador (en una comunidad donde solo los Directores crean
   Jugadores, explica a quién pedírselo). El paso 3 ofrece unos cuantos ajustes opcionales que puedes saltarte.

Tu cuenta (el correo con el que inicias sesión) y tu Jugador (el nombre en las clasificaciones) son cosas distintas.

### Publicar una Contrarreloj

- **Publicar un tiempo** (barra superior), o **Circuitos** → un circuito → **Publicar un tiempo**: introduce tu tiempo en 150cc o 200cc, comprueba
  los valores en la confirmación y publícalo.
- **Escanéalo**: abre `<your community address>/scanner/` en un móvil o una tablet. Apunta la cámara a la pantalla
  de resultados de tu tele, o elige **subir imagen** con una foto o una captura de pantalla. El escáner lee los tiempos, las vueltas
  y, cuando se ven, el personaje, la combinación del kart y la bandera. Comprueba cada valor antes de enviarlo; el reconocimiento puede
  equivocarse. La cámara necesita una dirección HTTPS de confianza (también funciona en `localhost`); subir una imagen funciona en cualquier sitio.
- Según las normas de la comunidad, un envío se puede publicar al momento o esperar a que lo revise un
  administrador. Un administrador puede corregir o retirar un tiempo publicado.

### Seguir tu progreso

**Circuitos**, **Ranking** y **Récords** muestran tus mejores tiempos y vueltas junto a la comunidad, los rivales que hayas elegido,
los fantasmas del personal de Nintendo y los récords mundiales. **Configuración** ayuda con las combinaciones de personaje y kart, **Comunidad**
muestra a otros Jugadores y **Torneos** las noches de torneo publicadas, las clasificaciones y los informes. Cuando alguien
bate uno de tus tiempos publicados, recibes una notificación (la campana). La web también puede enviar notificaciones push del navegador
si tu comunidad lo ha configurado; actívalas en los ajustes de tu cuenta.

La web está disponible en los 15 idiomas del juego (elige el tuyo en los ajustes). El inglés y el neerlandés están
revisados; los otros 13 son traducciones automáticas, y las correcciones son bienvenidas: consulta
[Change UI text and translations](../../../DEVELOPMENT.md#change-ui-text-and-translations) para el archivo que hay que editar y
[Contributing](../../../../CONTRIBUTING.md) para la pull request.

## La app de Android

La app ofrece un escaneo más rápido en el propio móvil, tus tiempos y notificaciones. Es opcional.

### Requisitos

- Android 8.0 o posterior; se recomienda un móvil arm64. El APK de release es grande (unos 530 MB): deja alrededor de
  1 GB libre durante la instalación.
- Una comunidad a la que la app pueda llegar: una **comunidad en línea** con una dirección HTTPS de confianza, o una **instalación de casa
  o de club** (A2) en el mismo wifi. Una dirección local del ordenador (`http://127.0.0.1:…`) no funciona en la app.

### Instalar

1. Consigue el APK en la página **Consigue la app** de tu comunidad cuando ofrezca descargas (tienes que haber iniciado sesión para
   verlas; esa es la versión que tu comunidad admite), o en la página
   [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) del proyecto: toma
   `mk8dx-android-release-….apk`. Con un clon del repositorio también puedes compilar el APK tú mismo:
   [Client builds](../../../CLIENT_BUILDS.md#android).
2. Comprueba el archivo con `SHA256SUMS.txt` de la misma release (en un ordenador: `Get-FileHash` en PowerShell,
   `sha256sum` en Linux, `shasum -a 256` en macOS).
3. Copia el APK al móvil y ábrelo desde **Archivos** o **Descargas**. Android pide permitir la instalación desde
   esa app; permítelo solo para este archivo comprobado y vuelve a desactivarlo después si quieres.

No es una app de Play Store. Los APK públicos anteriores se firmaron con una clave de compilación de depuración; el APK de release usa la
clave conservada del mantenedor. Guarda los resultados que aún no hayas enviado y desinstala una vez el APK de depuración anterior antes de instalar
esta release. Los APK posteriores firmados con la misma clave de release se actualizan sin desinstalar. Cambiar al APK de una comunidad o a uno
compilado por ti con otra clave también exige desinstalar.

### Primer inicio

La app se abre en **Elige tu comunidad**, en el idioma del móvil si la app lo tiene. Para elegir otro
idioma, toca **Idioma / Language** (con el globo) arriba; la app recuerda esa elección. Después te pregunta una sola cosa:
cómo juega tu comunidad. ¿No estás seguro? Pregunta a la
persona que lleva tu comunidad.

- **EN CASA O EN EL CLUB** (A2, MK8DX funciona en un ordenador allí): toca **Escanear el código QR** y escanea la
  tarjeta **Prepare a device** (preparar un dispositivo) que tu administrador muestra en ese ordenador o reparte en papel. El móvil debe estar en
  el mismo wifi. La app muestra entonces la dirección y la clave de la instalación; también están en la página **Prepare this
  device** (preparar este dispositivo), en **Full fingerprints** (huellas digitales completas). Toca **Conectar** cuando coincidan. No hace falta internet. Paso a paso:
  [la guía A2, capítulo 7](../../../install/translations/es/A2_HOME_GUIDE.md#7-la-app-de-android-y-livetrial).
- **COMUNIDAD EN LÍNEA** (una web en internet): introduce la dirección con la que la abres en el navegador, por ejemplo
  `https://www.example.org` (sin ruta y sin barra final), y toca **Guardar**. Si falla, abre la misma dirección en
  el navegador del móvil: debe abrirse sin aviso de certificado.

Después inicia sesión: toca el icono de persona arriba a la derecha e **Iniciar sesión**; Ajustes › **Jugador en este móvil** hace lo
mismo. La app muestra un código y abre tu comunidad en el navegador, donde confirmas con tu propia cuenta (en una
instalación de casa o de club la app te lo recuerda: inicia sesión allí primero con tu tarjeta de acceso personal).

### Orientarte

Arriba en la app ves el logotipo (vuelve a Inicio), el **chip de comunidad** con el nombre de la comunidad que estás
usando, la campana y tu nombre. Tu nombre abre **Tú**: tu Jugador con **Cambiar de Jugador**, y las pestañas
**Mis tiempos**, **Récords** y **Rivales**, con una fila **Ajustes** debajo.

- **Varias comunidades**: toca el chip de comunidad para abrir **Comunidades**. La activa está en verde; **Cambiar de comunidad**
  cambia a otra con un toque, **Quitar de este teléfono** olvida una (solo cuando no queda nada por enviar), y
  **Añadir una comunidad** vuelve a abrir la pantalla del primer inicio. Cada comunidad conserva su propio inicio de sesión, sus propias carreras
  sin enviar y, en casa o en el club, su propia confianza; nada pasa de una a otra por sí solo. Cuando el administrador
  ha dado un nombre a la comunidad, la app muestra ese nombre en lugar de la dirección.
- **Mis tiempos** es una sola lista: tus cifras de trayectoria y después una fila por circuito y clase con tu mejor marca personal; toca una
  fila para ver carreras anteriores y usa **⋯** en una carrera para **Detalles**, **Editar**, **Retirar** o
  **Llevar a otra comunidad…**.
- **Sin internet**: la app guarda una copia de tus propios tiempos y de los mejores tiempos de tus rivales por comunidad y
  la muestra con «Sin conexión — última actualización …».
- **Pendiente de enviar**: las carreras que todavía solo están en el móvil aparecen como un aviso naranja en Inicio y en Tú; tócalo,
  o usa Ajustes › **Guardado en este teléfono**, para verlas.
- **Ajustes** se agrupa en **Jugador**, **App**, **Comunidad** y **Acerca de**, y guarda cada cambio por sí solo.
  El idioma está en App; **Consigue la app** y **Guardado en este teléfono** están en Comunidad; **Hacer un escaneo de prueba**
  está en Acerca de.

### Llevar tiempos a otra comunidad

Si perteneces a más de una comunidad, un tiempo también puede contar en otra: **Llevar a otra comunidad…**
en una carrera, o **Llevar mis mejores tiempos** debajo de tus cifras de trayectoria en Mis tiempos (se saltan los circuitos en los que la otra comunidad
ya tiene un tiempo tuyo mejor). La copia espera hasta que hayas iniciado sesión allí. Decide la comunidad
**receptora**: por defecto no acepta tiempos de fuera, puede hacer que un administrador apruebe cada uno
antes, o puede aceptarlos como cualquier otro tiempo. Un tiempo traído siempre muestra de dónde viene («Traído de … ·
originalmente …»). El mismo original solo se acepta una vez; un tiempo igual solo rellena lo que le faltaba
a la carrera existente.

### Notificaciones

Las notificaciones de la app se recogen del buzón de tu comunidad; el permiso de notificaciones de Android y el
interruptor propio de la app tienen que estar activados los dos.

## Problemas

- No llega el correo de inicio de sesión: mira en spam, comprueba la dirección exacta y pide un enlace nuevo. En una instalación local de prueba el
  correo llega al buzón de prueba local, no a tu buzón de correo.
- Una reclamación se rechaza con *Demasiadas acciones de reclamación en este momento…*: espera el tiempo que indica y
  vuelve a intentarlo. Una cuenta puede tener como máximo 5 reclamaciones a la espera de decisión a la vez (un
  jugador, como máximo 5 de todas las cuentas juntas). Al llegar a ese límite, espera a que se resuelva una
  reclamación pendiente, o retira una con **Retirar esta solicitud**, y vuelve a intentarlo.
- Algo se ve mal en la web de tu comunidad: pregunta primero a quienes la llevan. Los errores del propio software
  se pueden comunicar en las issues del proyecto; consulta [SUPPORT.md](../../../../SUPPORT.md). Nunca publiques enlaces de inicio de sesión ni nombres
  de otras personas.
