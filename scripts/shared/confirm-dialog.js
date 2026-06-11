import { t } from "../platform/i18n.js";
import { modalLayer } from "../platform/modal-layer.js";
import { blurActiveElementWithin, restoreFocus } from "./focus-restoration.js";

let confirmDialogSeq = 0;

function getFocusableDialogNodes(dialog) {
    const selector = [
        "button:not([disabled])",
        "[href]",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        '[tabindex]:not([tabindex="-1"])'
    ].join(", ");

    return Array.from(dialog.querySelectorAll(selector)).filter((node) =>
        node instanceof HTMLElement &&
        !node.hasAttribute("disabled")
    );
}

export function confirmDialog(message, options = {}) {
    if (!document?.body) {
        return Promise.resolve(globalThis.confirm?.(message) ?? false);
    }

    const {
        title = "",
        confirmLabel = t("confirm") || "Confirm",
        cancelLabel = t("cancel") || "Cancel",
        confirmVariant = "primary",
    } = options;

    const modalId = `confirm-dialog-${++confirmDialogSeq}`;
    const overlay = document.createElement("div");
    overlay.className = "confirm-dialog-overlay";
    overlay.setAttribute("aria-hidden", "true");

    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("tabindex", "-1");
    if (title) {
        dialog.setAttribute("aria-labelledby", `${modalId}-title`);
    }
    dialog.setAttribute("aria-describedby", `${modalId}-message`);

    const headerMarkup = title
        ? `<div class="confirm-dialog__header"><h3 id="${modalId}-title">${escapeHtml(title)}</h3></div>`
        : "";
    const confirmClass = confirmVariant === "danger"
        ? "mac-button mac-button--danger"
        : "mac-button mac-button--primary";

    dialog.innerHTML = `
        ${headerMarkup}
        <div class="confirm-dialog__content">
            <p class="confirm-dialog__message" id="${modalId}-message">${escapeHtml(message)}</p>
        </div>
        <div class="confirm-dialog__footer">
            <button type="button" class="mac-button confirm-dialog__cancel">${escapeHtml(cancelLabel)}</button>
            <button type="button" class="${confirmClass} confirm-dialog__confirm">${escapeHtml(confirmLabel)}</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const previousActiveElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return new Promise((resolve) => {
        let settled = false;
        const handleKeydownCapture = (event) => {
            if (event.key !== "Tab") return;

            const focusable = getFocusableDialogNodes(dialog);
            if (focusable.length === 0) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            const first = focusable[0];
            const active = document.activeElement;

            if (!dialog.contains(active)) {
                event.preventDefault();
                event.stopPropagation();
                first.focus();
                return;
            }

            const activeIndex = focusable.indexOf(active);
            const currentIndex = activeIndex === -1
                ? 0
                : activeIndex;
            const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1);

            event.preventDefault();
            event.stopPropagation();
            focusable[nextIndex]?.focus();
        };
        window.addEventListener("keydown", handleKeydownCapture, true);

        const cleanup = (result) => {
            if (settled) return;
            settled = true;
            window.removeEventListener("keydown", handleKeydownCapture, true);

            restoreFocus(previousActiveElement, { excludeRoot: overlay });
            blurActiveElementWithin(overlay);

            modalLayer.unregister(modalId);
            overlay.classList.remove("active");
            overlay.setAttribute("aria-hidden", "true");

            const remove = () => {
                overlay.removeEventListener("transitionend", remove);
                overlay.remove();
            };

            overlay.addEventListener("transitionend", remove, { once: true });
            globalThis.setTimeout(remove, 180);
            resolve(result);
        };

        const cancelButton = dialog.querySelector(".confirm-dialog__cancel");
        const confirmButton = dialog.querySelector(".confirm-dialog__confirm");

        cancelButton?.addEventListener("click", () => cleanup(false));
        confirmButton?.addEventListener("click", () => cleanup(true));

        modalLayer.register(
            modalId,
            modalLayer.constructor.LEVEL.DIALOG,
            overlay,
            () => cleanup(false),
            {
                hitTestElement: dialog,
                zIndexElement: overlay,
            }
        );

        requestAnimationFrame(() => {
            overlay.classList.add("active");
            overlay.setAttribute("aria-hidden", "false");
            cancelButton?.focus();
        });
    });
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
