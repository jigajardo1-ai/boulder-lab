# Ruta

## Por qué no sirve pedirle los boulders a un chat con una foto

Un modelo general tiene que detectar las presas, adivinar distancias, imaginar un cuerpo y poner un grado, todo de una. Falla en las cuatro: se salta o inventa presas, no tiene escala, no sabe tu envergadura y el grado lo pone por intuición. Por eso esta app separa el problema en etapas: presas marcadas (o detectadas y corregidas), escala explícita, reglas físicas de alcance y un grado calibrado con datos reales.

## Fase 0: prototipo (esta versión)

- [x] Foto del muro, escala con dos puntos y piso, ángulo
- [x] Marcado manual de presas con tipo y tamaño
- [x] Boulders del armador con su grado, para calibrar
- [x] Generador por grado V, número de movimientos, cruces, lances y compresión
- [x] Registro de intentos: encadenado, intentos, sensación, estrellas, "se puede evitar"
- [x] Imagen para compartir y respaldo en JSON
- [ ] Probarlo en el muro real y mostrárselo al profe

**Para la sesión con el profe**, pedirle que revise 10 a 20 boulders generados con esta pauta:

1. ¿Tiene sentido? (sí / no / con ajustes)
2. ¿Qué grado le pondría?
3. ¿El movimiento pedido se hace de verdad o se puede evitar?
4. ¿Qué cambiaría?

Y además: un circuito de evaluación inicial y 3 o 4 plantillas de bloques de 4 semanas.

## Fase 1: detección automática de presas

- Etiquetar 100 a 200 fotos del muro (Roboflow o CVAT)
- Afinar un modelo de segmentación (YOLO-seg) y correrlo en el teléfono (TFLite / CoreML / ONNX web)
- La detección propone y el usuario corrige
- Corrección de perspectiva con las cuatro esquinas de un panel (homografía)

## Fase 2: app de teléfono más completa

- Varios ángulos por muro (paneles)
- Orientación de presas, para gastones y laterales
- Datos en la nube para compartir entre alumnos y con el profe

## Fase 3: grados y entrenamiento personalizado

- Modelo IRT: P(encadena) = 1 / (1 + e^-(h - d)), con habilidad h por persona y dificultad d por boulder
- Habilidad por tipo de movimiento (regletas, romos, desplome, dinámicos, placa)
- Evaluación inicial con boulders de grado conocido
- Planes de 4 semanas desde las plantillas del profe, re-evaluación con cada cambio de presas
- Límites de carga para no lesionar poleas en principiantes

## Fase 4: 3D

- Profundidad del teléfono (LiDAR, ARCore Depth) o fotogrametría con varias fotos
- Volúmenes y cambios de ángulo reales

## Fase 5: aprendizaje automático

- Modelo que puntúa los boulders generados con las estrellas y el "tiene sentido" de los alumnos
- Generación aprendida con los boulders graduados propios (los datos de MoonBoard o Kilter son propietarios)
