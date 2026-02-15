const btn = document.getElementById('backHomeBtn');

let isDragging = false;
let offsetX, offsetY;
let hasMoved = false; // track if mouse moved during drag

btn.addEventListener('mousedown', (e) => {
    isDragging = true;
    hasMoved = false;
    offsetX = e.clientX - btn.getBoundingClientRect().left;
    offsetY = e.clientY - btn.getBoundingClientRect().top;
    btn.style.cursor = 'grabbing';
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    btn.style.cursor = 'grab';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    let left = e.clientX - offsetX;
    let top = e.clientY - offsetY;

    // Prevent button from going outside viewport
    const maxLeft = window.innerWidth - btn.offsetWidth;
    const maxTop = window.innerHeight - btn.offsetHeight;
    left = Math.max(0, Math.min(left, maxLeft));
    top = Math.max(0, Math.min(top, maxTop));

    // Check if the button actually moved
    if (btn.offsetLeft !== left || btn.offsetTop !== top) {
        hasMoved = true;
    }

    btn.style.left = left + 'px';
    btn.style.top = top + 'px';
});

// Navigate back to dashboard ONLY if it was a real click, not a drag
btn.addEventListener('click', () => {
    if (!hasMoved) {
        window.location.href = '/dashboard';
    }
});


const exportBtn = document.getElementById('exportExcel');
exportBtn.addEventListener('click', () => {
    const month = exportBtn.dataset.month;
    const year = exportBtn.dataset.year;
    const fileName = `Attendance_${year}_${month}.xlsx`;

    const table = document.querySelector('table');
    const ws = XLSX.utils.table_to_sheet(table);

    // …rest of your SheetJS export code…
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, fileName);
});