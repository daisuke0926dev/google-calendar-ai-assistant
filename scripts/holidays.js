// 日本の祝日データ

class HolidayManager {
  constructor() {
    // 2026年の日本の祝日
    this.holidays2026 = [
      '2026-01-01', // 元日
      '2026-01-12', // 成人の日
      '2026-02-11', // 建国記念の日
      '2026-02-23', // 天皇誕生日
      '2026-03-20', // 春分の日
      '2026-04-29', // 昭和の日
      '2026-05-03', // 憲法記念日
      '2026-05-04', // みどりの日
      '2026-05-05', // こどもの日
      '2026-05-06', // 振替休日
      '2026-07-20', // 海の日
      '2026-08-11', // 山の日
      '2026-09-21', // 敬老の日
      '2026-09-22', // 秋分の日
      '2026-10-12', // スポーツの日
      '2026-11-03', // 文化の日
      '2026-11-23', // 勤労感謝の日
    ];

    // 2027年の祝日（今後の対応用）
    this.holidays2027 = [
      '2027-01-01', // 元日
      '2027-01-11', // 成人の日
      '2027-02-11', // 建国記念の日
      '2027-02-23', // 天皇誕生日
      '2027-03-20', // 春分の日
      '2027-04-29', // 昭和の日
      '2027-05-03', // 憲法記念日
      '2027-05-04', // みどりの日
      '2027-05-05', // こどもの日
      '2027-07-19', // 海の日
      '2027-08-11', // 山の日
      '2027-09-20', // 敬老の日
      '2027-09-23', // 秋分の日
      '2027-10-11', // スポーツの日
      '2027-11-03', // 文化の日
      '2027-11-23', // 勤労感謝の日
    ];
  }

  /**
   * 指定した日付が祝日かどうかを判定
   * @param {Date} date - 判定する日付
   * @returns {boolean} 祝日ならtrue
   */
  isHoliday(date) {
    const dateStr = this.formatDate(date);
    const year = date.getFullYear();

    let holidays;
    if (year === 2026) {
      holidays = this.holidays2026;
    } else if (year === 2027) {
      holidays = this.holidays2027;
    } else {
      // 2026-2027以外の年は基本的な祝日のみチェック
      const month = date.getMonth() + 1;
      const day = date.getDate();

      // 固定祝日のみチェック
      if (month === 1 && day === 1) return true; // 元日
      if (month === 2 && day === 11) return true; // 建国記念の日
      if (month === 2 && day === 23) return true; // 天皇誕生日
      if (month === 4 && day === 29) return true; // 昭和の日
      if (month === 5 && day === 3) return true; // 憲法記念日
      if (month === 5 && day === 4) return true; // みどりの日
      if (month === 5 && day === 5) return true; // こどもの日
      if (month === 8 && day === 11) return true; // 山の日
      if (month === 11 && day === 3) return true; // 文化の日
      if (month === 11 && day === 23) return true; // 勤労感謝の日

      return false;
    }

    return holidays.includes(dateStr);
  }

  /**
   * 指定した日付が週末（土日）かどうかを判定
   * @param {Date} date - 判定する日付
   * @returns {boolean} 週末ならtrue
   */
  isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = 日曜日, 6 = 土曜日
  }

  /**
   * 指定した日付が休日（週末または祝日）かどうかを判定
   * @param {Date} date - 判定する日付
   * @returns {boolean} 休日ならtrue
   */
  isNonWorkingDay(date) {
    return this.isWeekend(date) || this.isHoliday(date);
  }

  /**
   * 日付をYYYY-MM-DD形式にフォーマット
   * @param {Date} date - フォーマットする日付
   * @returns {string} YYYY-MM-DD形式の文字列
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 指定した日付の休日情報を取得
   * @param {Date} date - 判定する日付
   * @returns {Object} { isHoliday, isWeekend, dayName }
   */
  getHolidayInfo(date) {
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    return {
      isHoliday: this.isHoliday(date),
      isWeekend: this.isWeekend(date),
      isNonWorkingDay: this.isNonWorkingDay(date),
      dayName: dayNames[date.getDay()]
    };
  }
}

// グローバルインスタンスをエクスポート
const holidayManager = new HolidayManager();
