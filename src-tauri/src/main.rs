#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    prompt_arena_lib::run().expect("error while running Prompt Arena");
}
