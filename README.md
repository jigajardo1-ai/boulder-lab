# Boulder Lab

App web para el celular: sacas una foto del muro, marcas las presas y la app genera boulders por grado (escala V) y por tipo de movimiento para entrenar.

**Abrir la app:** https://jigajardo1-ai.github.io/boulder-lab/

No hay que instalar nada. En el celular se puede agregar a la pantalla de inicio desde el menú del navegador ("Agregar a pantalla de inicio").

## Cómo se usa

1. **Nuevo muro.** Saca la foto lo más de frente posible, con el muro entero y el piso a la vista. Cuando el gimnasio cambie las presas, crea un muro nuevo.
2. **Escala.** Toca dos puntos con una distancia conocida (por ejemplo el ancho de un terciado, 122 cm), marca el piso y elige el ángulo del muro.
3. **Presas.** Elige tipo (cazo, pinza, regleta, bidedo, romo, volumen o pie) y tamaño, y toca cada presa. Pellizca para hacer zoom.
4. **Gimnasio.** Marca los boulders del armador con su grado. Con eso la app calibra sus grados.
5. **Generar.** Elige grado, número de movimientos y si quieres cruces, lances o compresión. La app propone 3 opciones.
6. **Registro.** Por cada boulder anota si lo encadenaste, cuántos intentos, si se sintió más fácil o más difícil que el grado, estrellas y si el movimiento clave se puede evitar.

Desde ⚙ se cambia la altura y la envergadura, y se exporta un respaldo en JSON para pasárselo al profe o cambiarse de teléfono.

## Cómo funciona el motor

Todo está en [`js/engine.js`](js/engine.js). No usa IA: son reglas geométricas que se pueden revisar y ajustar con el profe.

- **Cuerpo.** Con la altura H y la envergadura W: alcance estático mano a mano de 0,55·W, lance hasta 0,8·W, pies entre 0,2·H y 0,38·W + 0,76·H bajo la mano más baja.
- **Movimiento.** El costo de cada movimiento suma la distancia (relativa al alcance), la presa a la que llegas, la presa en la que te quedas colgado, los pies disponibles y un extra por cruce, lance o compresión. Todo se multiplica por el ángulo del muro.
- **Grado.** La dificultad D de un boulder la manda su movimiento más duro, con algo de peso de los otros dos más duros y del largo. Se convierte a escala V con `V = a·D + b`.
- **Calibración.** `a` y `b` se ajustan con los boulders del armador (mínimos cuadrados, encogidos hacia los valores por defecto cuando hay pocos datos).
- **Beta.** Para evaluar un boulder la app supone la beta más fácil: en cada presa mueve la mano que cuesta menos. Si pediste un cruce y se puede evitar moviendo la otra mano, no cuenta como cruce.
- **Generador.** Miles de recorridos aleatorios desde presas de inicio alcanzables, prefiriendo subir, alternar manos y los movimientos pedidos. Se quedan los 3 que mejor calzan con el pedido y que no repiten casi las mismas presas.

## Limitaciones de esta versión

- Supone muro plano y foto de frente. Una foto en diagonal deforma las distancias.
- Un solo ángulo para todo el muro.
- La orientación de las presas no se usa todavía (no hay gastones ni laterales).
- Los datos viven solo en el navegador del teléfono. Exporta respaldos.

La ruta completa está en [ROADMAP.md](ROADMAP.md).

## Desarrollo

Es HTML, CSS y JavaScript sin dependencias ni compilación. Para probar en el computador:

```bash
python -m http.server 8000
```

y abrir http://localhost:8000. Las pruebas del motor están en http://localhost:8000/tests/.
