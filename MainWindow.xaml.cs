using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Navigation;

namespace MoreTimeAtHome
{
    public partial class MainWindow : Window
    {
        private int selectedYear;
        private string selectedCountryCode;
        private List<DateTime> nationalHolidays = new List<DateTime>();
        private List<DateTime> customHolidays = new List<DateTime>();
        private List<DateTime> plannedLeaves = new List<DateTime>();
        private HashSet<DateTime> weekendOverrides = new HashSet<DateTime>();
        private Dictionary<string, string> countries = new Dictionary<string, string>();
        private bool weekStartsMonday = true;

        private System.Windows.Forms.NotifyIcon trayIcon;

        public MainWindow()
        {
            InitializeComponent();
            InitializeCountries();
            InitializeYears();
            InitializeCalculateFrom();
            InitializeTrayIcon();
        }

        private void InitializeTrayIcon()
        {
            System.Drawing.Icon icon;
            try
            {
                icon = new System.Drawing.Icon("icon.ico");
            }
            catch
            {
                icon = System.Drawing.Icon.ExtractAssociatedIcon(
                           System.Reflection.Assembly.GetExecutingAssembly().Location
                       ) ?? System.Drawing.SystemIcons.Application;
            }

            trayIcon = new System.Windows.Forms.NotifyIcon
            {
                Text = "More Time At Home",
                Icon = icon,
                Visible = true
            };

            trayIcon.DoubleClick += (s, e) =>
            {
                Show();
                WindowState = WindowState.Normal;
                Activate();
            };

            var menu = new System.Windows.Forms.ContextMenuStrip();

            menu.Items.Add("Open", null, (s, e) =>
            {
                Show();
                WindowState = WindowState.Normal;
                Activate();
            });

            menu.Items.Add("Exit", null, (s, e) =>
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
                System.Windows.Application.Current.Shutdown();
            });

            trayIcon.ContextMenuStrip = menu;
        }

        protected override void OnStateChanged(EventArgs e)
        {
            base.OnStateChanged(e);

            if (WindowState == WindowState.Minimized)
            {
                Hide();
            }
        }

        protected override void OnClosed(EventArgs e)
        {
            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }

            base.OnClosed(e);
        }

        private void Hyperlink_RequestNavigate(object sender, RequestNavigateEventArgs e)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = e.Uri.AbsoluteUri,
                    UseShellExecute = true
                });
                e.Handled = true;
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Unable to open link: {ex.Message}", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void InitializeCountries()
        {
            countries = new Dictionary<string, string>
            {
                { "United States", "US" },
                { "United Kingdom", "GB" },
                { "Canada", "CA" },
                { "Germany", "DE" },
                { "France", "FR" },
                { "Spain", "ES" },
                { "Italy", "IT" },
                { "Portugal", "PT" },
                { "Netherlands", "NL" },
                { "Belgium", "BE" },
                { "Switzerland", "CH" },
                { "Austria", "AT" },
                { "Sweden", "SE" },
                { "Norway", "NO" },
                { "Denmark", "DK" },
                { "Finland", "FI" },
                { "Poland", "PL" },
                { "Australia", "AU" },
                { "New Zealand", "NZ" },
                { "Japan", "JP" },
                { "South Korea", "KR" },
                { "India", "IN" },
                { "Brazil", "BR" },
                { "Mexico", "MX" },
                { "Argentina", "AR" },
                { "South Africa", "ZA" }
            };

            CountryComboBox.ItemsSource = countries.Keys.OrderBy(k => k);
            CountryComboBox.SelectedIndex = 0;
        }

        private void InitializeYears()
        {
            var years = new List<int>();
            int currentYear = DateTime.Now.Year;
            for (int i = currentYear - 2; i <= currentYear + 5; i++)
            {
                years.Add(i);
            }
            YearComboBox.ItemsSource = years;
            YearComboBox.SelectedItem = currentYear;
        }

        private void InitializeCalculateFrom()
        {
            CalculateFromDatePicker.SelectedDate = new DateTime(DateTime.Now.Year, 1, 1);
        }

        private void MinimumConstraintCheckBox_Checked(object sender, RoutedEventArgs e)
        {
            Minimum5ConstraintCheckBox.IsChecked = true;
        }

        private void MinimumConstraintCheckBox_Unchecked(object sender, RoutedEventArgs e)
        {
        }

        private void Minimum10PaidConstraintCheckBox_Checked(object sender, RoutedEventArgs e)
        {
            Minimum5PaidConstraintCheckBox.IsChecked = true;
        }

        private void Minimum10PaidConstraintCheckBox_Unchecked(object sender, RoutedEventArgs e)
        {
        }

        private void Maximum5ConstraintCheckBox_Checked(object sender, RoutedEventArgs e)
        {
            Maximum10ConstraintCheckBox.IsChecked = false;
        }

        private void Maximum10ConstraintCheckBox_Checked(object sender, RoutedEventArgs e)
        {
            Maximum5ConstraintCheckBox.IsChecked = false;
        }

        private void Maximum5PaidConstraintCheckBox_Checked(object sender, RoutedEventArgs e)
        {
            Maximum10PaidConstraintCheckBox.IsChecked = false;
        }
        private void Maximum10PaidConstraintCheckBox_Checked(object sender, RoutedEventArgs e)
        {
            Maximum5PaidConstraintCheckBox.IsChecked = false;
        }

        private void WeekStartComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            weekStartsMonday = WeekStartComboBox.SelectedIndex == 0;
            if (selectedYear != 0) RenderCalendar();
        }

        private async void YearComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (YearComboBox.SelectedItem != null)
            {
                selectedYear = (int)YearComboBox.SelectedItem;

                if (CalculateFromDatePicker.SelectedDate.HasValue)
                {
                    var currentDate = CalculateFromDatePicker.SelectedDate.Value;
                    CalculateFromDatePicker.SelectedDate = new DateTime(selectedYear, currentDate.Month, currentDate.Day);
                }
                else
                {
                    CalculateFromDatePicker.SelectedDate = new DateTime(selectedYear, 1, 1);
                }

                await LoadHolidaysAndRefreshCalendar();
            }
        }

        private async void CountryComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (CountryComboBox.SelectedItem != null)
            {
                string selectedCountry = CountryComboBox.SelectedItem.ToString();
                selectedCountryCode = countries[selectedCountry];
                await LoadHolidaysAndRefreshCalendar();
            }
        }

        private async Task LoadHolidaysAndRefreshCalendar()
        {
            if (selectedYear == 0 || string.IsNullOrEmpty(selectedCountryCode))
                return;

            StatusTextBlock.Text = "Loading holidays...";
            plannedLeaves.Clear();

            await FetchNationalHolidays();
            RenderCalendar();

            StatusTextBlock.Text = $"Loaded {nationalHolidays.Count} national holidays for {selectedYear}";
        }

        private async Task FetchNationalHolidays()
        {
            nationalHolidays.Clear();

            try
            {
                using (HttpClient client = new HttpClient())
                {
                    string url = $"https://date.nager.at/api/v3/PublicHolidays/{selectedYear}/{selectedCountryCode}";
                    HttpResponseMessage response = await client.GetAsync(url);

                    if (response.IsSuccessStatusCode)
                    {
                        string json = await response.Content.ReadAsStringAsync();
                        var holidays = JsonSerializer.Deserialize<List<Holiday>>(json);

                        if (holidays != null)
                        {
                            foreach (var holiday in holidays)
                            {
                                if (!string.IsNullOrEmpty(holiday.date))
                                {
                                    nationalHolidays.Add(DateTime.Parse(holiday.date));
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error fetching holidays: {ex.Message}", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        private void RenderCalendar()
        {
            CalendarGrid.Children.Clear();

            for (int month = 1; month <= 12; month++)
            {
                var monthPanel = CreateMonthPanel(month);
                CalendarGrid.Children.Add(monthPanel);
            }
        }

        private Border CreateMonthPanel(int month)
        {
            var border = new Border
            {
                BorderBrush = Brushes.Gray,
                BorderThickness = new Thickness(1),
                Margin = new Thickness(1.5)
            };

            var stackPanel = new StackPanel();

            var headerText = new TextBlock
            {
                Text = new DateTime(selectedYear, month, 1).ToString("MMMM yyyy"),
                FontSize = 10.5,
                FontWeight = FontWeights.Bold,
                TextAlignment = TextAlignment.Center,
                Padding = new Thickness(2),
                Background = new SolidColorBrush(Color.FromRgb(70, 130, 180)),
                Foreground = Brushes.White
            };
            stackPanel.Children.Add(headerText);

            var dayHeaderGrid = new Grid();
            for (int i = 0; i < 7; i++)
            {
                dayHeaderGrid.ColumnDefinitions.Add(new ColumnDefinition());
            }

            string[] dayNames = weekStartsMonday
                ? new[] { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" }
                : new[] { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };

            for (int i = 0; i < 7; i++)
            {
                var dayHeader = new TextBlock
                {
                    Text = dayNames[i],
                    TextAlignment = TextAlignment.Center,
                    FontWeight = FontWeights.Bold,
                    FontSize = 8,
                    Padding = new Thickness(0.5),
                    Background = new SolidColorBrush(Color.FromRgb(240, 240, 240))
                };
                Grid.SetColumn(dayHeader, i);
                dayHeaderGrid.Children.Add(dayHeader);
            }
            stackPanel.Children.Add(dayHeaderGrid);

            DateTime firstDay = new DateTime(selectedYear, month, 1);
            int daysInMonth = DateTime.DaysInMonth(selectedYear, month);

            int startDayOfWeek = weekStartsMonday
                ? (((int)firstDay.DayOfWeek + 6) % 7)
                : (int)firstDay.DayOfWeek;

            int totalCells = (int)Math.Ceiling((startDayOfWeek + daysInMonth) / 7.0) * 7;
            int rows = totalCells / 7;

            var daysGrid = new Grid();
            for (int i = 0; i < rows; i++)
            {
                daysGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(19) });
            }
            for (int i = 0; i < 7; i++)
            {
                daysGrid.ColumnDefinitions.Add(new ColumnDefinition());
            }

            int currentDay = 1;
            for (int row = 0; row < rows; row++)
            {
                for (int col = 0; col < 7; col++)
                {
                    int cellIndex = row * 7 + col;

                    if (cellIndex >= startDayOfWeek && currentDay <= daysInMonth)
                    {
                        DateTime date = new DateTime(selectedYear, month, currentDay);
                        var dayBorder = CreateDayCell(date, currentDay);
                        Grid.SetRow(dayBorder, row);
                        Grid.SetColumn(dayBorder, col);
                        daysGrid.Children.Add(dayBorder);
                        currentDay++;
                    }
                    else
                    {
                        var emptyBorder = new Border
                        {
                            BorderBrush = Brushes.LightGray,
                            BorderThickness = new Thickness(0.5),
                            Background = Brushes.WhiteSmoke
                        };
                        Grid.SetRow(emptyBorder, row);
                        Grid.SetColumn(emptyBorder, col);
                        daysGrid.Children.Add(emptyBorder);
                    }
                }
            }

            stackPanel.Children.Add(daysGrid);
            border.Child = stackPanel;

            return border;
        }

        private Border CreateDayCell(DateTime date, int dayNumber)
        {
            var border = new Border
            {
                BorderBrush = Brushes.Gray,
                BorderThickness = new Thickness(0.5),
                Padding = new Thickness(0.5),
                Cursor = Cursors.Hand
            };

            var textBlock = new TextBlock
            {
                Text = dayNumber.ToString(),
                TextAlignment = TextAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                FontSize = 8.5
            };

            bool isNaturalWeekend = IsNaturalWeekend(date);
            bool isWorkingWeekend = weekendOverrides.Contains(date);

            if (plannedLeaves.Contains(date))
            {
                border.Background = new SolidColorBrush(Color.FromRgb(144, 238, 144));
                textBlock.FontWeight = FontWeights.Bold;
            }
            else if (customHolidays.Contains(date))
            {
                border.Background = new SolidColorBrush(Color.FromRgb(255, 192, 203));
                textBlock.FontWeight = FontWeights.Bold;
            }
            else if (nationalHolidays.Contains(date) && isNaturalWeekend && !isWorkingWeekend)
            {
                border.Background = new SolidColorBrush(Color.FromRgb(255, 107, 107));
                textBlock.FontWeight = FontWeights.Bold;
            }
            else if (nationalHolidays.Contains(date))
            {
                border.Background = new SolidColorBrush(Color.FromRgb(76, 201, 240));
                textBlock.FontWeight = FontWeights.Bold;
            }
            else if (isNaturalWeekend && !isWorkingWeekend)
            {
                border.Background = new SolidColorBrush(Color.FromRgb(249, 199, 79));
            }
            else
            {
                border.Background = Brushes.White;
            }

            border.MouseLeftButtonDown += (s, e) => DayCell_Click(date);
            border.Child = textBlock;
            return border;
        }

        private void DayCell_Click(DateTime date)
        {
            bool isNaturalWeekend = IsNaturalWeekend(date);
            bool wasNational = nationalHolidays.Contains(date);
            bool wasCustom = customHolidays.Contains(date);
            bool wasPlanned = plannedLeaves.Contains(date);
            bool wasWorkingWeekend = weekendOverrides.Contains(date);

            nationalHolidays.Remove(date);
            customHolidays.Remove(date);
            plannedLeaves.Remove(date);

            if (wasPlanned)
            {
                if (isNaturalWeekend)
                {
                    weekendOverrides.Add(date);
                }
            }
            else if (isNaturalWeekend && !wasWorkingWeekend && !wasNational && !wasCustom)
            {
                plannedLeaves.Add(date);
            }
            else if (isNaturalWeekend && wasWorkingWeekend)
            {
                weekendOverrides.Remove(date);
            }
            else if (wasCustom)
            {
                plannedLeaves.Add(date);
            }
            else if (wasNational)
            {
                customHolidays.Add(date);
            }
            else
            {
                nationalHolidays.Add(date);
            }

            RenderCalendar();
        }

        private bool IsNaturalWeekend(DateTime date)
        {
            return date.DayOfWeek == DayOfWeek.Saturday || date.DayOfWeek == DayOfWeek.Sunday;
        }

        private bool IsWeekend(DateTime date)
        {
            return IsNaturalWeekend(date) && !weekendOverrides.Contains(date);
        }

        private void ClearButton_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new Window
            {
                Title = "Clear Options",
                Width = 320,
                Height = 250,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                ResizeMode = ResizeMode.NoResize
            };

            var stackPanel = new StackPanel { Margin = new Thickness(20) };

            var instructionText = new TextBlock
            {
                Text = "Select what to clear:",
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 0, 0, 15)
            };
            stackPanel.Children.Add(instructionText);

            var clearWeekends = new CheckBox { Content = "Weekend overrides", Margin = new Thickness(0, 0, 0, 10) };
            var clearNational = new CheckBox { Content = "National holidays", Margin = new Thickness(0, 0, 0, 10) };
            var clearCustom = new CheckBox { Content = "Custom holidays", Margin = new Thickness(0, 0, 0, 10), IsChecked = true };
            var clearPlanned = new CheckBox { Content = "Planned leaves", Margin = new Thickness(0, 0, 0, 15), IsChecked = true };

            stackPanel.Children.Add(clearWeekends);
            stackPanel.Children.Add(clearNational);
            stackPanel.Children.Add(clearCustom);
            stackPanel.Children.Add(clearPlanned);

            var buttonPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };

            var okButton = new Button
            {
                Content = "OK",
                Width = 80,
                Height = 30,
                Margin = new Thickness(0, 0, 10, 0)
            };
            okButton.Click += (s, ev) =>
            {
                if (clearWeekends.IsChecked == true) weekendOverrides.Clear();
                if (clearNational.IsChecked == true) nationalHolidays.Clear();
                if (clearCustom.IsChecked == true) customHolidays.Clear();
                if (clearPlanned.IsChecked == true) plannedLeaves.Clear();

                RenderCalendar();
                StatusTextBlock.Text = "Cleared selected items";
                dialog.Close();
            };

            var cancelButton = new Button
            {
                Content = "Cancel",
                Width = 80,
                Height = 30
            };
            cancelButton.Click += (s, ev) => dialog.Close();

            buttonPanel.Children.Add(okButton);
            buttonPanel.Children.Add(cancelButton);
            stackPanel.Children.Add(buttonPanel);

            dialog.Content = stackPanel;
            dialog.ShowDialog();
        }

        private void HowToButton_Click(object sender, RoutedEventArgs e)
        {
            var dialog = new Window
            {
                Title = "How to Use Holiday Planner",
                Width = 600,
                Height = 500,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                ResizeMode = ResizeMode.NoResize
            };

            var scrollViewer = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Padding = new Thickness(20)
            };

            var stackPanel = new StackPanel();

            // Setup
            var section1Text = new TextBlock
            {
                Text = "1. Pick the Year and Country\n" +
                "The national holidays of the Country will automatically popup. If any adjustments are required, you can click on National Holidays in the calendar to turn them into any other type of day (see the Calendar Colors section)" +
                       "2. Enter how many Paid Leaves you have per year\n" +
                       "3. Set 'Calculate from' date if you need to plan your leaves from a specific date (optimization starts from this date)",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(10, 0, 0, 15),
                FontSize = 11
            };
            stackPanel.Children.Add(section1Text);

            // Calendar Colors
            var section2Title = new TextBlock
            {
                Text = "Calendar Colors",
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 0, 0, 5)
            };
            stackPanel.Children.Add(section2Title);

            var section2Text = new TextBlock
            {
                Text = "White = Working day\n" +
                       "Blue = National Holiday (from API)\n" +
                       "Pink = Custom Holiday (Treat it as a 'must force a Planned Leave this day')\n" +
                       "Green = Planned Leave (Will appear after clicking the optimize button, with the purpose of maximizing time at home)\n" +
                       "Yellow = Weekend\n" +
                       "Red = Holiday on weekend (wasted)\n" +
                       "Note: By default the app sets all weekends as days off. You can click on any weekend day to turn it into a working day if required.",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(10, 0, 0, 15),
                FontSize = 11
            };
            stackPanel.Children.Add(section2Text);

            // Constraints
            var section4Title = new TextBlock
            {
                Text = "Constraints",
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 0, 0, 5)
            };
            stackPanel.Children.Add(section4Title);

            var section4Text = new TextBlock
            {
                Text = "Days Off (in a row)\n" +
       "If you select Min X, the optimizer will only create leave blocks that result in at least X consecutive days off in total.\n" +
       "Days Off includes weekends and national/custom holidays.\n\n" +
       "Paid Leaves (in a row)\n" +
       "If you select Min X, the optimizer will force at least X consecutive paid leave days in a block.\n" +
       "Paid Leaves counts only actual leave days (excluding national holidays in between - some companies enforce 10 paid leaves in a row).\n\n" +
       "Max works the same way but sets an upper limit instead of a minimum.\n\n" +
       "Example: 3 paid leaves (Mon–Wed) before a weekend\n" +
       "→ Days Off = 5 (Mon, Tue, Wed, Sat, Sun)\n" +
       "→ Paid Leaves = 3 (Mon, Tue, Wed)",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(10, 0, 0, 15),
                FontSize = 11
            };
            stackPanel.Children.Add(section4Text);

            // Optimize Button
            var section5Title = new TextBlock
            {
                Text = "Optimize Button",
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 0, 0, 5)
            };
            stackPanel.Children.Add(section5Title);

            var section5Text = new TextBlock
            {
                Text = "Automatically places your planned leaves (green) to maximize total days off.\n" +
                       "Works by finding weekends (days off), national holidays and custom holidays and maximizing planned leaves period.\n",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(10, 0, 0, 15),
                FontSize = 11
            };
            stackPanel.Children.Add(section5Text);

            // Close button
            var closeButton = new Button
            {
                Content = "Got it",
                Width = 100,
                Height = 32,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 10, 0, 0),
                Background = new SolidColorBrush(Color.FromRgb(76, 175, 80)),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0)
            };
            closeButton.Click += (s, ev) => dialog.Close();
            stackPanel.Children.Add(closeButton);

            scrollViewer.Content = stackPanel;
            dialog.Content = scrollViewer;
            dialog.ShowDialog();
        }

        private void SaveButton_Click(object sender, RoutedEventArgs e)
        {
            var saveDialog = new SaveFileDialog
            {
                Filter = "Holiday Plan (*.hplan)|*.hplan",
                DefaultExt = ".hplan",
                FileName = $"HolidayPlan_{selectedYear}_{selectedCountryCode}.hplan"
            };

            if (saveDialog.ShowDialog() == true)
            {
                try
                {
                    var plan = new HolidayPlan
                    {
                        Year = selectedYear,
                        CountryCode = selectedCountryCode,
                        NationalHolidays = nationalHolidays,
                        CustomHolidays = customHolidays,
                        PlannedLeaves = plannedLeaves,
                        WeekendOverrides = weekendOverrides.ToList(),
                        PaidLeavesAmount = PaidLeavesTextBox.Text,
                        CalculateFrom = CalculateFromDatePicker.SelectedDate,
                        Require10DaysOff = MinimumConstraintCheckBox.IsChecked == true,
                        Require5DaysOff = Minimum5ConstraintCheckBox.IsChecked == true,
                        Require10PaidLeaves = Minimum10PaidConstraintCheckBox.IsChecked == true,
                        Require5PaidLeaves = Minimum5PaidConstraintCheckBox.IsChecked == true,
                        Maximum10DaysOff = Maximum10ConstraintCheckBox.IsChecked == true,
                        Maximum5DaysOff = Maximum5ConstraintCheckBox.IsChecked == true,
                        Maximum10PaidLeaves = Maximum10PaidConstraintCheckBox.IsChecked == true,
                        Maximum5PaidLeaves = Maximum5PaidConstraintCheckBox.IsChecked == true
                    };

                    var json = JsonSerializer.Serialize(plan, new JsonSerializerOptions { WriteIndented = true });
                    File.WriteAllText(saveDialog.FileName, json);

                    StatusTextBlock.Text = "Plan saved successfully";
                    MessageBox.Show("Plan saved successfully!", "Save", MessageBoxButton.OK, MessageBoxImage.Information);
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Error saving plan: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
        }

        private void LoadButton_Click(object sender, RoutedEventArgs e)
        {
            var openDialog = new OpenFileDialog
            {
                Filter = "Holiday Plan (*.hplan)|*.hplan",
                DefaultExt = ".hplan"
            };

            if (openDialog.ShowDialog() == true)
            {
                try
                {
                    var json = File.ReadAllText(openDialog.FileName);
                    var plan = JsonSerializer.Deserialize<HolidayPlan>(json);

                    if (plan != null)
                    {
                        selectedYear = plan.Year;
                        selectedCountryCode = plan.CountryCode;
                        nationalHolidays = plan.NationalHolidays ?? new List<DateTime>();
                        customHolidays = plan.CustomHolidays ?? new List<DateTime>();
                        plannedLeaves = plan.PlannedLeaves ?? new List<DateTime>();
                        weekendOverrides = new HashSet<DateTime>(plan.WeekendOverrides ?? new List<DateTime>());

                        YearComboBox.SelectedItem = plan.Year;

                        var countryName = countries.FirstOrDefault(x => x.Value == plan.CountryCode).Key;
                        if (!string.IsNullOrEmpty(countryName))
                        {
                            CountryComboBox.SelectedItem = countryName;
                        }

                        PaidLeavesTextBox.Text = plan.PaidLeavesAmount ?? "20";
                        CalculateFromDatePicker.SelectedDate = plan.CalculateFrom;
                        MinimumConstraintCheckBox.IsChecked = plan.Require10DaysOff;
                        Minimum5ConstraintCheckBox.IsChecked = plan.Require5DaysOff;
                        Minimum10PaidConstraintCheckBox.IsChecked = plan.Require10PaidLeaves;
                        Minimum5PaidConstraintCheckBox.IsChecked = plan.Require5PaidLeaves;
                        Maximum10ConstraintCheckBox.IsChecked = plan.Maximum10DaysOff;
                        Maximum5ConstraintCheckBox.IsChecked = plan.Maximum5DaysOff;
                        Maximum10PaidConstraintCheckBox.IsChecked = plan.Maximum10PaidLeaves;
                        Maximum5PaidConstraintCheckBox.IsChecked = plan.Maximum5PaidLeaves;

                        RenderCalendar();
                        StatusTextBlock.Text = "Plan loaded successfully";
                        MessageBox.Show("Plan loaded successfully!", "Load", MessageBoxButton.OK, MessageBoxImage.Information);
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Error loading plan: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
        }

        private async void MaximizeButton_Click(object sender, RoutedEventArgs e)
        {
            if (selectedYear == 0 || string.IsNullOrEmpty(selectedCountryCode))
            {
                MessageBox.Show("Please select a year and country first.", "Information",
                    MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            if (!int.TryParse(PaidLeavesTextBox.Text, out int paidLeavesAmount) || paidLeavesAmount < 0)
            {
                MessageBox.Show("Please enter a valid number of paid leaves.", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            bool requireMinimum10DaysOff = MinimumConstraintCheckBox.IsChecked == true;
            bool requireMinimum5DaysOff = Minimum5ConstraintCheckBox.IsChecked == true;
            bool requireMinimum10PaidLeaves = Minimum10PaidConstraintCheckBox.IsChecked == true;
            bool requireMinimum5PaidLeaves = Minimum5PaidConstraintCheckBox.IsChecked == true;
            bool requireMaximum10DaysOff = Maximum10ConstraintCheckBox.IsChecked == true;
            bool requireMaximum5DaysOff = Maximum5ConstraintCheckBox.IsChecked == true;
            bool requireMaximum10PaidLeaves = Maximum10PaidConstraintCheckBox.IsChecked == true;
            bool requireMaximum5PaidLeaves = Maximum5PaidConstraintCheckBox.IsChecked == true;

            DateTime startDate = CalculateFromDatePicker.SelectedDate ?? new DateTime(selectedYear, 1, 1);
            if (startDate.Year != selectedYear)
            {
                startDate = new DateTime(selectedYear, startDate.Month, startDate.Day);
            }

            StatusTextBlock.Text = "Calculating optimal leave distribution...";
            MaximizeButton.IsEnabled = false;

            await Task.Run(() =>
            {
                CalculateOptimalLeaves(paidLeavesAmount, requireMinimum10DaysOff, requireMinimum5DaysOff,
                    requireMinimum10PaidLeaves, requireMinimum5PaidLeaves,
                    requireMaximum10DaysOff, requireMaximum5DaysOff,
                    requireMaximum10PaidLeaves, requireMaximum5PaidLeaves, startDate);
            });

            RenderCalendar();
            DisplayStatistics(paidLeavesAmount);

            MaximizeButton.IsEnabled = true;
            StatusTextBlock.Text = "Optimization complete!";
        }

        private void CalculateOptimalLeaves(int paidLeavesAmount, bool requireMinimum10DaysOff, bool requireMinimum5DaysOff,
            bool requireMinimum10PaidLeaves, bool requireMinimum5PaidLeaves,
            bool requireMaximum10DaysOff, bool requireMaximum5DaysOff,
            bool requireMaximum10PaidLeaves, bool requireMaximum5PaidLeaves, DateTime startDate)
        {
            plannedLeaves.Clear();

            if (paidLeavesAmount == 0)
                return;

            var allDays = new List<DateTime>();
            DateTime currentDate = startDate;
            while (currentDate.Year == selectedYear)
            {
                allDays.Add(currentDate);
                currentDate = currentDate.AddDays(1);
            }

            var opportunities = new List<LeaveOpportunity>();

            for (int i = 0; i < allDays.Count; i++)
            {
                DateTime opportunityStart = allDays[i];

                if (IsWeekend(opportunityStart) || nationalHolidays.Contains(opportunityStart) || customHolidays.Contains(opportunityStart))
                    continue;

                for (int leaveLength = 1; leaveLength <= Math.Min(paidLeavesAmount, 20); leaveLength++)
                {
                    if (requireMinimum10DaysOff && leaveLength < 10)
                        continue;
                    if (requireMinimum5DaysOff && leaveLength < 5)
                        continue;

                    var opportunity = EvaluateLeaveOpportunity(allDays, opportunityStart, leaveLength);
                    if (opportunity != null && opportunity.RequiredLeaves <= paidLeavesAmount)
                    {
                        if (requireMaximum10DaysOff && opportunity.TotalDaysOff > 10)
                            continue;
                        if (requireMaximum5DaysOff && opportunity.TotalDaysOff > 5)
                            continue;
                        if (requireMaximum10PaidLeaves && opportunity.RequiredLeaves > 10)
                            continue;
                        if (requireMaximum5PaidLeaves && opportunity.RequiredLeaves > 5)
                            continue;

                        opportunities.Add(opportunity);
                    }
                }
            }

            opportunities = opportunities
                .OrderByDescending(o => o.Efficiency)
                .ThenByDescending(o => o.TotalDaysOff)
                .ToList();

            int leavesRemaining = paidLeavesAmount;
            var usedDates = new HashSet<DateTime>();
            bool constraintSatisfied = false;

            if (requireMinimum10PaidLeaves || requireMinimum5PaidLeaves)
            {
                int requiredConsecutive = requireMinimum10PaidLeaves ? 10 : 5;

                foreach (var opportunity in opportunities)
                {
                    if (opportunity.RequiredLeaves > leavesRemaining)
                        continue;

                    int consecutivePaidLeaves = CountConsecutivePaidLeaves(opportunity.LeaveDates);

                    if (consecutivePaidLeaves >= requiredConsecutive)
                    {
                        foreach (var date in opportunity.LeaveDates)
                        {
                            plannedLeaves.Add(date);
                            usedDates.Add(date);
                        }
                        leavesRemaining -= opportunity.RequiredLeaves;
                        constraintSatisfied = true;
                        break;
                    }
                }

                if (!constraintSatisfied)
                {
                    System.Windows.Application.Current.Dispatcher.Invoke(() =>
                    {
                        StatusTextBlock.Text = $"Cannot satisfy constraint: need {requiredConsecutive} paid leaves in a row";
                    });
                    return;
                }
            }

            foreach (var opportunity in opportunities)
            {
                if (leavesRemaining == 0)
                    break;

                bool overlaps = opportunity.LeaveDates.Any(d => usedDates.Contains(d));

                if (!overlaps && opportunity.RequiredLeaves <= leavesRemaining)
                {
                    int consecutivePaidLeaves = CountConsecutivePaidLeaves(opportunity.LeaveDates);

                    if (requireMaximum10PaidLeaves && consecutivePaidLeaves > 10)
                        continue;
                    if (requireMaximum5PaidLeaves && consecutivePaidLeaves > 5)
                        continue;

                    foreach (var date in opportunity.LeaveDates)
                    {
                        plannedLeaves.Add(date);
                        usedDates.Add(date);
                    }
                    leavesRemaining -= opportunity.RequiredLeaves;
                }
            }

            if (leavesRemaining > 0 && !requireMinimum10DaysOff && !requireMinimum5DaysOff &&
                !requireMinimum10PaidLeaves && !requireMinimum5PaidLeaves)
            {
                var singleDayOpportunities = opportunities
                    .Where(o => o.RequiredLeaves == 1 && !o.LeaveDates.Any(d => usedDates.Contains(d)))
                    .Take(leavesRemaining);

                foreach (var opportunity in singleDayOpportunities)
                {
                    plannedLeaves.Add(opportunity.LeaveDates[0]);
                }
            }
        }

        private int CountConsecutivePaidLeaves(List<DateTime> leaveDates)
        {
            if (leaveDates.Count == 0)
                return 0;

            var sortedDates = leaveDates.OrderBy(d => d).ToList();
            var leaveSet = new HashSet<DateTime>(sortedDates);

            int maxConsecutive = 0;
            int currentConsecutive = 0;
            DateTime? previousDate = null;

            foreach (var date in sortedDates)
            {
                if (previousDate == null)
                {
                    currentConsecutive = 1;
                }
                else
                {
                    DateTime checkDate = previousDate.Value.AddDays(1);
                    bool streakBroken = false;

                    while (checkDate < date)
                    {
                        if (nationalHolidays.Contains(checkDate) || customHolidays.Contains(checkDate))
                        {
                            streakBroken = true;
                            break;
                        }
                        else if (!IsWeekend(checkDate) && !leaveSet.Contains(checkDate))
                        {
                            streakBroken = true;
                            break;
                        }

                        checkDate = checkDate.AddDays(1);
                    }

                    if (streakBroken)
                    {
                        maxConsecutive = Math.Max(maxConsecutive, currentConsecutive);
                        currentConsecutive = 1;
                    }
                    else
                    {
                        currentConsecutive++;
                    }
                }

                previousDate = date;
            }

            maxConsecutive = Math.Max(maxConsecutive, currentConsecutive);
            return maxConsecutive;
        }

        private LeaveOpportunity EvaluateLeaveOpportunity(List<DateTime> allDays, DateTime startDate, int leaveLength)
        {
            var leaveDates = new List<DateTime>();
            var totalDaysOff = new HashSet<DateTime>();

            DateTime currentDate = startDate;
            int leavesAdded = 0;

            while (leavesAdded < leaveLength)
            {
                if (IsWeekend(currentDate) || nationalHolidays.Contains(currentDate) || customHolidays.Contains(currentDate))
                {
                    currentDate = currentDate.AddDays(1);
                    if (currentDate.Year != selectedYear)
                        return null;
                    continue;
                }

                leaveDates.Add(currentDate);
                leavesAdded++;
                currentDate = currentDate.AddDays(1);
                if (currentDate.Year != selectedYear)
                    break;
            }

            if (leavesAdded < leaveLength)
                return null;

            DateTime checkStart = startDate;

            DateTime lookBack = startDate.AddDays(-1);
            while (lookBack.Year == selectedYear &&
                   (IsWeekend(lookBack) || nationalHolidays.Contains(lookBack) || customHolidays.Contains(lookBack)))
            {
                checkStart = lookBack;
                lookBack = lookBack.AddDays(-1);
            }

            DateTime checkDate = checkStart;
            while (checkDate.Year == selectedYear)
            {
                if (IsWeekend(checkDate) || nationalHolidays.Contains(checkDate) || customHolidays.Contains(checkDate) || leaveDates.Contains(checkDate))
                {
                    totalDaysOff.Add(checkDate);
                    checkDate = checkDate.AddDays(1);
                }
                else
                {
                    break;
                }
            }

            if (totalDaysOff.Count == 0)
                return null;

            return new LeaveOpportunity
            {
                StartDate = checkStart,
                LeaveDates = leaveDates,
                RequiredLeaves = leaveLength,
                TotalDaysOff = totalDaysOff.Count,
                Efficiency = (double)totalDaysOff.Count / leaveLength
            };
        }

        private void DisplayStatistics(int allocatedLeaves)
        {
            int usedLeaves = plannedLeaves.Count;
            int totalDaysOff = CalculateTotalDaysOff();
            int workingDays = CalculateWorkingDays();
            int totalDays = IsLeapYear(selectedYear) ? 366 : 365;

            StatisticsTextBlock.Text = $"Statistics for {selectedYear}: " +
                $"Paid Leaves Used: {usedLeaves}/{allocatedLeaves} | " +
                $"National Holidays: {nationalHolidays.Count} | " +
                $"Custom Holidays: {customHolidays.Count} | " +
                $"Total Days Off: {totalDaysOff} ({(totalDaysOff * 100.0 / totalDays):F1}%) | " +
                $"Working Days: {workingDays} | " +
                $"Efficiency: {(usedLeaves > 0 ? (totalDaysOff - CountWeekendsAndHolidays()) / (double)usedLeaves : 0):F2} extra days per leave";
        }

        private int CalculateTotalDaysOff()
        {
            int count = 0;
            for (int month = 1; month <= 12; month++)
            {
                int daysInMonth = DateTime.DaysInMonth(selectedYear, month);
                for (int day = 1; day <= daysInMonth; day++)
                {
                    DateTime date = new DateTime(selectedYear, month, day);
                    if (IsWeekend(date) || nationalHolidays.Contains(date) || customHolidays.Contains(date) || plannedLeaves.Contains(date))
                    {
                        count++;
                    }
                }
            }
            return count;
        }

        private int CalculateWorkingDays()
        {
            int totalDays = IsLeapYear(selectedYear) ? 366 : 365;
            return totalDays - CalculateTotalDaysOff();
        }

        private int CountWeekendsAndHolidays()
        {
            int count = 0;
            for (int month = 1; month <= 12; month++)
            {
                int daysInMonth = DateTime.DaysInMonth(selectedYear, month);
                for (int day = 1; day <= daysInMonth; day++)
                {
                    DateTime date = new DateTime(selectedYear, month, day);
                    if (IsWeekend(date) || nationalHolidays.Contains(date) || customHolidays.Contains(date))
                    {
                        count++;
                    }
                }
            }
            return count;
        }

        private bool IsLeapYear(int year)
        {
            return DateTime.IsLeapYear(year);
        }
    }

    public class Holiday
    {
        public string date { get; set; }
        public string localName { get; set; }
        public string name { get; set; }
    }

    public class LeaveOpportunity
    {
        public DateTime StartDate { get; set; }
        public List<DateTime> LeaveDates { get; set; }
        public int RequiredLeaves { get; set; }
        public int TotalDaysOff { get; set; }
        public double Efficiency { get; set; }
    }

    public class HolidayPlan
    {
        public int Year { get; set; }
        public string CountryCode { get; set; }
        public List<DateTime> NationalHolidays { get; set; }
        public List<DateTime> CustomHolidays { get; set; }
        public List<DateTime> PlannedLeaves { get; set; }
        public List<DateTime> WeekendOverrides { get; set; }
        public string PaidLeavesAmount { get; set; }
        public DateTime? CalculateFrom { get; set; }
        public bool Require10DaysOff { get; set; }
        public bool Require5DaysOff { get; set; }
        public bool Require10PaidLeaves { get; set; }
        public bool Require5PaidLeaves { get; set; }
        public bool Maximum10DaysOff { get; set; }
        public bool Maximum5DaysOff { get; set; }
        public bool Maximum10PaidLeaves { get; set; }
        public bool Maximum5PaidLeaves { get; set; }
    }
}