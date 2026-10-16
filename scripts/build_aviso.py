#!/usr/bin/env python3
"""
Genera aviso-de-privacidad.html a partir de contenido/_plantilla.html.

Se usa la plantilla del sitio para no introducir diseno nuevo: mismo header,
mismo footer, misma tipografia y mismos estilos de articulo. Lo unico propio
es el texto legal.

    python scripts/build_aviso.py
"""

import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "contenido", "_plantilla.html")
OUTPUT = os.path.join(ROOT, "aviso-de-privacidad.html")

TITULO = "Aviso de privacidad"
DEK = ("Cómo Grupo CISA recaba, usa y protege los datos personales que usted "
       "comparte a través de este sitio.")

# Datos verificados contra el propio sitio (contacto.html).
# Los que faltan van con la convencion [DATO FALTANTE: ...] que ya usa el proyecto.
RAZON_SOCIAL = "[DATO FALTANTE: denominación o razón social completa de Grupo CISA]"
DOMICILIO = ("Circuito Circunvalación Poniente No. 16, Local V-W, Ciudad Satélite, "
             "Naucalpan, Estado de México, C.P. 53100")
CORREO = "contacto@grupocisa.mx"
TELEFONO = "55 5361 3771, ext. 251 o 237"
WHATSAPP = "55 1796 4940"

CUERPO = """
<p><em>Última actualización: 8 de octubre de 2026.</em></p>

<p>Este aviso describe el tratamiento que Grupo CISA da a los datos personales
recabados a través de este sitio web, en cumplimiento de la Ley Federal de
Protección de Datos Personales en Posesión de los Particulares.</p>

<h2>1. Quién es responsable de sus datos</h2>
<p>El responsable del tratamiento de sus datos personales es
<strong>{razon_social}</strong> (&laquo;Grupo CISA&raquo;), con domicilio en
{domicilio}.</p>
<p>Para cualquier asunto relacionado con este aviso puede escribir a
<a href="mailto:{correo}">{correo}</a> o llamar al {telefono}.</p>

<h2>2. Qué datos recabamos</h2>
<p>A través de los formularios de este sitio recabamos únicamente los datos que
usted decide proporcionarnos:</p>
<ul>
  <li><strong>Datos de identificación y contacto:</strong> nombre, teléfono y,
      cuando usted lo escribe, correo electrónico.</li>
  <li><strong>Datos sobre el inmueble:</strong> ubicación aproximada del predio,
      superficie y uso previsto.</li>
  <li><strong>El contenido del mensaje</strong> que usted redacte.</li>
</ul>
<p>No recabamos datos personales sensibles, ni datos patrimoniales o financieros
a través de este sitio.</p>

<h2>3. Para qué los usamos</h2>
<p>Finalidades primarias, necesarias para atenderle:</p>
<ul>
  <li>Responder su solicitud de información o de contacto.</li>
  <li>Elaborar una evaluación preliminar del potencial de desarrollo de su
      terreno y presentarle escenarios.</li>
  <li>Agendar visitas, citas y reuniones de seguimiento.</li>
</ul>
<p>Finalidades secundarias, que no son necesarias y a las que usted puede
oponerse sin que ello afecte la atención de su solicitud:</p>
<ul>
  <li>Enviarle información sobre desarrollos, avances de obra y oportunidades
      de inversión de Grupo CISA.</li>
  <li>Elaborar estadísticas internas de origen de contacto.</li>
</ul>
<p>Si no desea que sus datos se usen para las finalidades secundarias, escríbanos
a <a href="mailto:{correo}">{correo}</a> indicándolo. Basta con decirlo; no hay
formato ni requisito adicional.</p>

<h2>4. Cómo se envían y a dónde llegan sus datos</h2>
<p>Los formularios de este sitio <strong>no envían sus datos a un servidor de
Grupo CISA</strong>. Al pulsar enviar, el sitio arma un mensaje con los campos
que usted llenó y lo abre en WhatsApp para que usted decida si lo manda. Usted
conserva el control: hasta que no envíe ese mensaje, Grupo CISA no recibe nada.</p>
<p>Cuando usted envía el mensaje, la conversación queda alojada en la
infraestructura de WhatsApp, operada por Meta Platforms, Inc., y se rige además
por las políticas de privacidad de ese servicio.</p>

<h2>5. Borradores guardados en su navegador</h2>
<p>Para que no pierda lo que escribió si cierra la página por accidente, el sitio
guarda un borrador de los campos del formulario en el almacenamiento local
(<code>localStorage</code>) de su propio navegador.</p>
<p>Ese borrador <strong>no se transmite a Grupo CISA ni a ningún tercero</strong>:
vive únicamente en su dispositivo. Puede borrarlo en cualquier momento con el
botón &laquo;Borrar borrador&raquo; del propio formulario, o limpiando los datos
del sitio desde la configuración de su navegador.</p>
<p>Este sitio no utiliza cookies de publicidad ni de rastreo entre sitios.</p>

<h2>6. Con quién compartimos sus datos</h2>
<p>Grupo CISA no vende, alquila ni comercializa datos personales.</p>
<p>Sus datos pueden compartirse, solo en lo necesario para atender su solicitud,
con: notarios y asesores legales que intervengan en la operación; peritos y
valuadores que evalúen el predio; e instituciones financieras o fiduciarias
cuando el proyecto lo requiera. En todos los casos se transmite el mínimo
indispensable y con el mismo deber de confidencialidad.</p>
<p>También podremos revelar datos cuando lo exija una autoridad competente en
ejercicio de sus facultades.</p>

<h2>7. Sus derechos ARCO</h2>
<p>Usted tiene derecho a conocer qué datos suyos tenemos y para qué los usamos
(<strong>Acceso</strong>), a pedir que se corrijan si son inexactos
(<strong>Rectificación</strong>), a solicitar que los eliminemos cuando considere
que no se requieren (<strong>Cancelación</strong>) y a oponerse a un uso
específico (<strong>Oposición</strong>). También puede revocar en cualquier
momento el consentimiento que nos haya otorgado.</p>
<p>Para ejercer cualquiera de estos derechos, escriba a
<a href="mailto:{correo}">{correo}</a> con:</p>
<ul>
  <li>Su nombre y un medio para contactarle.</li>
  <li>Copia de una identificación oficial que acredite su identidad.</li>
  <li>Una descripción clara de qué datos y qué derecho quiere ejercer.</li>
</ul>
<p>Responderemos en un plazo máximo de veinte días hábiles. Si procede, la
solicitud se hará efectiva dentro de los quince días hábiles siguientes.</p>

<h2>8. Cambios a este aviso</h2>
<p>Este aviso puede actualizarse por cambios en nuestros servicios, en la
legislación aplicable o en nuestras prácticas internas. Cualquier modificación
se publicará en esta misma página, con su fecha de actualización al inicio.</p>

<h2>9. Si no está conforme</h2>
<p>Si considera que su derecho a la protección de datos personales ha sido
vulnerado, puede acudir ante el Instituto Nacional de Transparencia, Acceso a la
Información y Protección de Datos Personales (INAI),
<a href="https://home.inai.org.mx/" target="_blank" rel="noopener noreferrer">home.inai.org.mx</a>.</p>

<h2>10. Contacto</h2>
<p>Grupo CISA<br />
{domicilio}<br />
Teléfono: {whatsapp} y {telefono}<br />
WhatsApp: {whatsapp}<br />
Correo: <a href="mailto:{correo}">{correo}</a></p>
""".format(
    razon_social=RAZON_SOCIAL,
    domicilio=DOMICILIO,
    correo=CORREO,
    telefono=TELEFONO,
    whatsapp=WHATSAPP,
)


def build():
    html = io.open(TEMPLATE, encoding="utf-8", newline="").read()

    # La pagina vive en la raiz, no en /contenido/: se corrigen las rutas.
    html = html.replace('="../', '="')

    # Fuera el hero decorativo, el CTA comercial y el bloque de articulos
    # relacionados: en una pagina legal no vienen al caso.
    html = re.sub(r'[ \t]*<figure class="article__hero".*?</figure>\r?\n?', "",
                  html, flags=re.DOTALL)
    html = re.sub(r'[ \t]*<!-- ========== CTA FINAL ========== -->.*?</aside>\r?\n?', "",
                  html, flags=re.DOTALL)
    html = re.sub(r'[ \t]*(?:<!--[^>]*?-->\s*)?<section class="related".*?</section>\r?\n?', "",
                  html, flags=re.DOTALL)
    # El byline de autor/tiempo de lectura tampoco aplica.
    html = re.sub(r'[ \t]*<div class="article__byline">.*?</div>\r?\n?', "",
                  html, flags=re.DOTALL)

    # La miga de pan apunta a Contenido; aqui es una pagina de raiz.
    html = re.sub(
        r'<a href="contenido\.html">Contenido</a>\s*'
        r'<span class="breadcrumb-sep" aria-hidden="true">/</span>\s*',
        "", html)

    reemplazos = {
        "__TITULO_CORTO__": TITULO,
        "__TITULO__": TITULO,
        "__KICKER__": "Legal",
        "__DEK__": DEK,
        "__ARTICLE_BODY__": CUERPO.strip(),
    }
    for marca, valor in reemplazos.items():
        html = html.replace(marca, valor)

    # Cualquier marcador de la plantilla que haya quedado sin usar.
    sobrantes = sorted(set(re.findall(r"__[A-Z0-9_]+__", html)))
    for marca in sobrantes:
        html = html.replace(marca, "")
    if sobrantes:
        print("  marcadores vaciados: " + ", ".join(sobrantes))

    # El enlace del footer a "#aviso" ya tiene destino real.
    html = html.replace('href="#aviso"', 'href="aviso-de-privacidad.html"')

    io.open(OUTPUT, "w", encoding="utf-8", newline="").write(html)
    print("Escrito: aviso-de-privacidad.html ({:,} bytes)".format(len(html)))


if __name__ == "__main__":
    build()
