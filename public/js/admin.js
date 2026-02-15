const downloadBtn = document.getElementById('downloadReportBtn');

if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
        const monthInput = document.getElementById('monthInput');
        if (!monthInput.value) {
            alert("Please select a month");
            return;
        }

        const [year, month] = monthInput.value.split('-');
        const fileName = `Attendance_${year}_${month}.xlsx`;

        try {
            // Fetch the rendered attendance page for that month/year
            const response = await fetch(`/api/report/attendance?month=${month}&year=${year}`);
            const htmlText = await response.text();

            // Create a temporary DOM element to parse HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlText;

            // Find the table in fetched HTML
            const table = tempDiv.querySelector('table');
            if (!table) {
                alert("No table found for the selected month/year");
                return;
            }

            // Export using SheetJS
            const ws = XLSX.utils.table_to_sheet(table);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
            XLSX.writeFile(wb, fileName);

        } catch (err) {
            console.error(err);
            alert("Failed to fetch attendance table. Make sure the month/year exists.");
        }
    });
}



