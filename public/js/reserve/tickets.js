$(function(){
    var locale = $('input[name="locale"]').val();

    // 券種変更イベント
    $(document).on('change', 'select', function(){
        showTotalCharge()
    });

    // 次へ
    $('.btn-next').on('click', function(){
        // 座席コードリストを取得
        var choices = [];
        $('.table-tickets tbody tr').each(function(){
            choices.push({
                seat_code: $(this).attr('data-seat-code'),
                ticket_type_code: $('option:selected', this).val(),
                watcher_name: $('input', this).val()
            });
        });

        $('form input[name="choices"]').val(JSON.stringify(choices));
        $('form').submit();
    });

    /**
     * 合計金額を表示する
     */
    function showTotalCharge() {
        var total = 0;

        $('.table-tickets tbody tr').each(function(){
            total += parseInt($('option:selected', this).attr('data-charge'));
            total += parseInt($(this).attr('data-seat-extra-charge'));
        });

        if (locale === 'ja') {
            $('.price').text(total + '円');
        } else {
            $('.price').text(total + 'yen');
        }
    }

    showTotalCharge()
});