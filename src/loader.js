export function show(show) {
    const loaderEl = document.querySelector('#loader');
    loaderEl.style.display = show ? "block" : "none"
    // disable input field.
    const inputEl = document.querySelector("#chat-input");
    // const formEl = document.querySelector("#chat-form");
    inputEl.disabled = true;
}
