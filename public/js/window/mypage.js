$(function(){
    // 予約番号ごとにまとめた予約ドキュメントリスト
    var reservations = [];
    var conditions = {
        limit: $('.search-form input[name="limit"]').val(),
        page: '1'
    };

    function showReservations() {
        var html = '';

        reservations.forEach(function(reservation) {
            let purchasedAt = (reservation.purchased_at) ? (new Date(reservation.purchased_at)).toLocaleString('ja'): '';

            html += ''
            + '<tr data-seat-code="' + reservation.seat_code + '" data-reservation-id="' + reservation._id + '">'
                + '<th class="td-checkbox"><input type="checkbox" value=""></th>'
                + '<td class="td-number">' + reservation.payment_no + '</td>'
                + '<td class="">' + $('input[name="purchaser_group_name_' + reservation.purchaser_group + '"]').val() + '</td>'
                + '<td class="">' + purchasedAt + '</td>'
                + '<td class="">' + reservation.purchaser_email + '</td>'
                + '<td class="">' + reservation.purchaser_tel + '</td>'
                + '<td class="">' + reservation.purchaser_last_name + ' ' + reservation.purchaser_first_name + '</td>'
                + '<td class="td-title">'
                    + reservation.film_name_en + '<br>'
                    + reservation.performance_day + ' ' + reservation.performance_start_time + ' ～<br>'
                    + reservation.theater_name_en + ' ' + reservation.screen_name_en + ''
                + '</td>'
                + '<td class="td-seat"><a href="javascript:void(0);" class="show-seat-position" data-screen-id="' + reservation.screen.toString() + '" data-seat-codes="' + reservation.seat_code + '">' + reservation.seat_code + '</a></td>'
                + '<td class="td-actions">'
                    + '<p class="btn confirm-cancel"><span>Cancel</span></p>'
                    + '<p class="btn"><span>Print</span></p>'
                + '</td>'
            + '</tr>';
        });

        $('#reservations').html(html);
    }

    /**
     * ページャーを表示する
     * 
     * @param {number} count 全件数
     */
    function showPager(count) {
        var html = '';
        var page = parseInt(conditions.page);
        var limit = parseInt(conditions.limit);

        if (page > 1) {
            html += ''
            + '<span><a href="javascript:void(0)" class="change-page" data-page="1">&lt;</a></span>'
            + '<span><a href="javascript:void(0)" class="change-page" data-page="1">最初</a></span>'
            ;
        }

        pages = Math.ceil(count / parseInt(limit));

        for (var i=0; i<pages; i++) {
            var _page = i + 1;
            if (parseInt(page) === i + 1) {
                html += '<span>' + _page + '</span>';
            } else {
                html += '<span><a href="javascript:void(0)" class="change-page" data-page="' + _page + '">' + _page + '</a></span>';
            }
        }

        if (parseInt(page) < pages) {
            html += ''
            + '<span><a href="javascript:void(0)" class="change-page" data-page="' + pages + '">最後</a></span>'
            + '<span><a href="javascript:void(0)" class="change-page" data-page="' + pages + '">&gt;</a></span>';
        }

        $('.navigation').html(html);
    }

    function showConditions() {
        var formDatas = $('.search-form').serializeArray();
        formDatas.forEach(function(formData, index){
            var name = formData.name;
            if (conditions.hasOwnProperty(name)) {
                $('input[name="' + name + '"], select[name="' + name + '"]', $('.search-form')).val(conditions[name]);
            } else {
                $('input[name="' + name + '"], select[name="' + name + '"]', $('.search-form')).val('');
            }
        });
    }

    function search() {
        conditions.searched_at = Date.now(); // ブラウザキャッシュ対策

        $.ajax({
            dataType: 'json',
            url: $('.search-form').attr('action'),
            type: 'GET',
            data: conditions,
            beforeSend: function() {
                $('.loading').modal();
                $('.wrapper-reservations input[type="checkbox"]').prop('checked', false);
            }
        }).done(function(data) {
            if (data.isSuccess) {
                reservations = data.results;

                showReservations();
                showPager(parseInt(data.count));
                showConditions();
                $('.total-count').text(data.count);

            } else {
            }
        }).fail(function(jqxhr, textStatus, error) {
        }).always(function() {
            $('.loading').modal('hide');
        });
    }

    // 検索
    $(document).on('click', '.search-form .btn', function(){
        conditions.page = '1';

        // 検索フォームの値を全て条件に追加
        var formDatas = $('.search-form').serializeArray();
        formDatas.forEach(function(formData, index){
            conditions[formData.name] = formData.value;
        });

        search();
    });

    // ページ変更
    $(document).on('click', '.change-page', function(){
        conditions.page = $(this).attr('data-page');
        search();
    });

    // キャンセルしようとしている予約IDリスト
    var reservationsIds4cancel = [];

    // キャンセル確認
    $(document).on('click', '.confirm-cancel', function(){
        var reservationId = $(this).parent().parent().attr('data-reservation-id');
        var seatCode = $(this).parent().parent().attr('data-seat-code');

        reservationsIds4cancel = [reservationId];

        $('.cancel-reservation-confirm .modal-body').html('Are you sure you cancel \'' + seatCode + '\'?');
        $('.cancel-reservation-confirm').modal();
    });

    // キャンセル実行
    $(document).on('click', '.execute-cancel', function(){
        $.ajax({
            dataType: 'json',
            url: $('input[name="urlCancel"]').val(),
            type: 'POST',
            data: {
                reservationIds: JSON.stringify(reservationsIds4cancel)
            },
            beforeSend: function() {
                $('.cancel-reservation-confirm').modal('hide');
            }
        }).done(function(data) {
            if (data.isSuccess) {
                // 再検索
                search();

                $('.cancel-reservation-complete').modal();
            } else {
                alert('Failed canceling.');
            }
        }).fail(function(jqxhr, textStatus, error) {
        }).always(function() {
        });
    });

    // 配布先更新
    $(document).on('click', '.update-watcher-name', function(){
        var reservationId = $(this).parent().parent().parent().attr('data-reservation-id');
        var watcherName = $('input', $(this).parent().parent()).val();

        $.ajax({
            dataType: 'json',
            url: $('input[name="urlUpdateWatcherName"]').val(),
            type: 'POST',
            data: {
                reservationId: reservationId,
                watcherName: watcherName,
            },
            beforeSend: function() {
            }
        }).done(function(data) {
            if (data.isSuccess) {
                // 再検索
                search();

            } else {
                alert('Failed Updating.');
            }
        }).fail(function(jqxhr, textStatus, error) {
        }).always(function() {
        });
    });

    // まとめて操作
    $(document).on('click', '.action-to-reservations', function(){
        var action = $('select[name="action"]').val();

        if (action === 'cancel') {
            reservationsIds4cancel = [];
            var _seatCodes = [];

            // チェック予約リストを取得
            $('.td-checkbox input[type="checkbox"]:checked').map(function(){
                var reservationId = $(this).parent().parent().attr('data-reservation-id');
                var seatCode = $(this).parent().parent().attr('data-seat-code');

                if (reservationId) {
                    reservationsIds4cancel.push(reservationId);
                    _seatCodes.push(seatCode);
                }
            });

            if (reservationsIds4cancel.length < 1) {
                alert('Select reservations.');
            } else {
                // 確認モーダル表示
                $('.cancel-reservation-confirm .modal-body').html('Are you sure you cancel \'' + _seatCodes.join('、') + '\'?');
                $('.cancel-reservation-confirm').modal();
            }

        } else if (action === 'print') {
            alert('Sorry not yet.');
        } else {
            alert('Select Your Action.');
        }
    });

    // 全てチェックする
    $(document).on('click', '.check-all', function(){
        $('.td-checkbox input[type="checkbox"]').prop('checked', $(this).is(':checked'));
    });

    // 予約リスト表示
    // search();
});
