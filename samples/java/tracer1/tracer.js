import {
  addExercise,
  Code,
  Frame,
} from "/assets/tracer/script/codecheck_tracer.js";

addExercise(function* (sim) {
  // 1. Add the code with main and add methods
  const code = sim.add(
    0,
    0,
    new Code(`
      public class Adder {
        public static void main(String[] args) {
          int x = 7;
          int y = 5;
          int sum = add(x, y);
        }

        public static int add(int a, int b) {
          int result = a + b;
          return result;
        }
      }`)
  );

  // 2. Add a frame for the main method's variables
  const vars_main = sim.add(10, 0, new Frame("main variables"));
  vars_main.x = "";
  vars_main.y = "";
  vars_main.sum = "";

  // 3. Wait for the user to click Start
  code.go(3);
  yield sim.start();

  // --- TRACE MAIN METHOD ---
  vars_main.x = 7;
  yield sim.pause("Initialize x");
  code.go(4);
  vars_main.y = 5;
  yield sim.pause("Initialize y");

  // Ask student to select the method call line
  yield code.ask(5, "Select the next line to execute.");

  // --- TRACE METHOD CALL ---
  // Ask student to jump into the add method
  yield code.ask(8, "Execution moves to the start of the add method. Select that line.");

  // Create a new frame for the add method's scope
  const vars_add = sim.add(6, 5, new Frame("add variables"));
  vars_add.a = vars_main.x;
  vars_add.b = vars_main.y;
  vars_add.result = "";
  yield sim.pause("Parameters a and b are initialized.");

  // Ask student to select the calculation line
  yield code.ask(9, "Select the next line inside the add method.");

  // Ask student to set the result
  yield sim.set(
    vars_add.result,
    vars_add.a + vars_add.b,
    "Calculate a + b and update the result"
  );

  // Ask student to select the return line
  yield code.ask(10, "Select the return statement.");

  // --- TRACE RETURN ---
  // Ask student to select the line execution returns to in main
  yield code.ask(5, "Execution returns to the calling line. Select it.");

  // Update the 'sum' variable in main with the return value
  vars_main.sum = vars_add.result;
  // The add method's variables go out of scope
  sim.remove(vars_add);
  yield sim.pause("The return value is assigned to sum, and the 'add' method's variables are removed.");

  // Ask student to select the end of the main method
  // yield code.ask(6, "The method is complete. Select the closing brace.");
});
